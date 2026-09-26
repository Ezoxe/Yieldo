"""How many wrong passwords a door takes before it makes the caller wait.

In memory, and that is enough for this deployment: one uvicorn process serves
the household (`docker/Dockerfile` starts no worker pool), so a counter in this
process sees every attempt. A restart forgets them, which gives an attacker
nothing they did not already have.

Two keys, because the two attacks are different:

* (address, email) -- someone guessing ONE account's password. Five failures in
  fifteen minutes is more than a human mistyping ever needs;
* address alone -- someone walking a list of accounts. Fifty.

A success forgets the (address, email) failures and nothing else: the owner
signing in does not reset the counter an attacker built against other accounts
from the same address.

Memory stays bounded without a timer. Every failure costs the caller one Argon2
verification, so the number of keys alive inside one window is limited by what
the processor can hash; the keys whose window has passed are swept once the
table grows past `MAX_KEYS`, at most once per window, so a flood cannot turn
the sweep itself into the cost.

The clock is injected so the tests can move it; the application uses
`time.monotonic`, which a change of system time cannot rewind.
"""

import math
import time
from collections import deque
from collections.abc import Callable, Hashable
from dataclasses import dataclass, field

WINDOW_SECONDS = 15 * 60
MAX_FAILURES_PER_ACCOUNT = 5
MAX_FAILURES_PER_ADDRESS = 50
MAX_KEYS = 10_000


@dataclass
class LoginThrottle:
    clock: Callable[[], float] = time.monotonic
    _by_account: dict[tuple[str, str], deque[float]] = field(default_factory=dict)
    _by_address: dict[str, deque[float]] = field(default_factory=dict)
    _last_sweep: float = float("-inf")

    def _recent(self, bucket: dict, key: Hashable, *, create: bool) -> deque[float]:
        """The key's failures still inside the window. A read never creates an
        entry: only a failure is worth remembering."""
        now = self.clock()
        stamps = bucket.get(key)
        if stamps is None:
            stamps = deque()
            if create:
                bucket[key] = stamps
            return stamps
        while stamps and now - stamps[0] >= WINDOW_SECONDS:
            stamps.popleft()
        return stamps

    def retry_after(self, address: str, email: str) -> int | None:
        """Seconds the caller must wait before trying again, or None."""
        now = self.clock()
        waits: list[float] = []
        account = self._recent(self._by_account, (address, email), create=False)
        if len(account) >= MAX_FAILURES_PER_ACCOUNT:
            waits.append(account[0] + WINDOW_SECONDS - now)
        from_address = self._recent(self._by_address, address, create=False)
        if len(from_address) >= MAX_FAILURES_PER_ADDRESS:
            waits.append(from_address[0] + WINDOW_SECONDS - now)
        if not waits:
            return None
        return max(1, math.ceil(max(waits)))

    def record_failure(self, address: str, email: str) -> None:
        now = self.clock()
        self._recent(self._by_account, (address, email), create=True).append(now)
        self._recent(self._by_address, address, create=True).append(now)
        crowded = len(self._by_account) + len(self._by_address) > MAX_KEYS
        if crowded and now - self._last_sweep >= WINDOW_SECONDS:
            self._sweep()
            self._last_sweep = now

    def record_success(self, address: str, email: str) -> None:
        self._by_account.pop((address, email), None)

    def _sweep(self) -> None:
        for bucket in (self._by_account, self._by_address):
            for key in list(bucket):
                if not self._recent(bucket, key, create=False):
                    del bucket[key]


def wait_message(seconds: int) -> str:
    minutes = max(1, math.ceil(seconds / 60))
    unit = "minute" if minutes == 1 else "minutes"
    return f"Trop de tentatives de connexion. Réessayez dans {minutes} {unit}."


login_throttle = LoginThrottle()
