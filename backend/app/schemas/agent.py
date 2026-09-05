from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AgentQueryIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    # Left None to take the application's own budget. A household that wants a
    # longer investigation says so per question rather than raising a setting
    # it then forgets about.
    max_steps: int | None = Field(default=None, ge=1, le=40)


class AgentStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    position: int
    kind: str
    name: str
    summary: str


class AgentRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question: str
    state: str
    answer: str | None
    notice: str | None
    steps_used: int
    created_at: datetime
    finished_at: datetime | None
    steps: list[AgentStepOut]
    # The proposals THIS run produced, so the answer can be read beside what it
    # is asking for rather than sending the reader to another screen to find out.
    proposals: list["ProposalOut"]


class ProposalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int | None
    kind: str
    summary: str
    # The engine-computed figure the model was looking at. A proposal with an
    # empty one is a suggestion with nothing behind it, and the screen says so.
    evidence: str
    payload: dict
    before: dict
    state: str
    decision_note: str | None
    applied_summary: str | None
    affected: int
    created_at: datetime
    decided_at: datetime | None


class ProposalDecisionIn(BaseModel):
    """Why a proposal was refused, in the household's own words. Optional:
    refusing without explaining is a legitimate answer."""

    note: str | None = Field(default=None, max_length=2000)


AgentRunOut.model_rebuild()
