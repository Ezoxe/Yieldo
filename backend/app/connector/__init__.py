"""The surface EZLink's Yieldo agent talks to: a catalogue of tools, each one
an existing route, and the machinery that replays a call against it.

`catalog.py` is the table (one line per tool, and `NEVER` for the routes the
connector must not reach), `schema.py` derives each tool's input schema from
the route's own OpenAPI, `describe.py` writes the French sentence an approval
shows, and `dispatch.py` maps arguments onto the route and replays it in
process. `api/connector.py` exposes the three endpoints.
"""
