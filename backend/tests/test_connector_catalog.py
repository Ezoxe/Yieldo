"""The connector's catalogue against the application it describes.

Every write route of the application is a decision: in the catalogue at a
tier, or in `NEVER` with a reason. These tests fail the day a route is added
without that decision, the day a tool points at a route that moved, and the
day a tool would open a route behind the session wall.
"""

import json
import re

from app.connector.catalog import CATALOG, CUSTOM, NEVER, catalog_payload, input_schema
from app.connector.routes_index import api_routes, dependencies_of
from app.security.deps import get_session_user, require_session_admin

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SESSION_ONLY = {get_session_user, require_session_admin}


def routed_tools():
    return [tool for tool in CATALOG.values() if tool.path != CUSTOM]


def test_every_tool_points_at_a_route_that_exists():
    routes = api_routes()
    missing = [(tool.name, tool.method, tool.path) for tool in routed_tools()
               if (tool.method, tool.path) not in routes]
    assert missing == []


def test_no_tool_opens_a_route_behind_the_session_wall():
    routes = api_routes()
    walled = [tool.name for tool in routed_tools()
              if SESSION_ONLY & dependencies_of(routes[(tool.method, tool.path)])]
    assert walled == []


def test_every_write_route_is_in_the_catalogue_or_refused_with_a_reason():
    covered = {(tool.method, tool.path) for tool in routed_tools()}
    undecided = sorted(
        key for key in api_routes()
        if key[0] in WRITE_METHODS
        and not key[1].startswith("/connector")
        and key not in covered and key not in NEVER
    )
    assert undecided == []


def test_every_refusal_names_a_route_that_exists_and_a_reason():
    routes = api_routes()
    assert [key for key in NEVER if key not in routes] == []
    assert all(reason.strip() for reason in NEVER.values())


def test_a_refused_route_is_never_also_a_tool():
    covered = {(tool.method, tool.path) for tool in routed_tools()}
    assert covered & set(NEVER) == set()


def test_every_session_only_write_route_is_refused():
    routes = api_routes()
    walled = {key for key, route in routes.items()
              if key[0] in WRITE_METHODS and SESSION_ONLY & dependencies_of(route)}
    assert walled - set(NEVER) == set()


def test_every_deletion_waits_for_the_household():
    assert [tool.name for tool in routed_tools()
            if tool.method == "DELETE" and tool.tier != "approve"] == []


def test_every_approval_has_its_sentence_and_only_approvals_have_one():
    approvals = {tool.name for tool in CATALOG.values() if tool.tier == "approve"}
    described = {tool.name for tool in CATALOG.values() if tool.describer is not None}
    assert approvals == described


def test_tool_names_are_namespaced_and_titles_written():
    for tool in CATALOG.values():
        assert re.fullmatch(r"yieldo_[a-z0-9_]+", tool.name), tool.name
        assert len(tool.name) <= 64
        assert tool.title.strip()


def test_reads_take_finance_read_and_everything_else_finance_write():
    for tool in CATALOG.values():
        assert tool.scope == ("finance_read" if tool.tier == "read" else "finance_write")


def test_every_input_schema_is_a_closed_object_with_no_reference_left():
    for tool in CATALOG.values():
        schema = input_schema(tool)
        assert schema["type"] == "object", tool.name
        assert schema.get("additionalProperties") is False, tool.name
        assert "$ref" not in json.dumps(schema), tool.name
        assert set(schema.get("required", [])) <= set(schema["properties"]), tool.name


def test_a_path_parameter_is_a_required_argument():
    schema = input_schema(CATALOG["yieldo_supprimer_transaction"])
    assert schema["required"] == ["transaction_id"]
    assert schema["properties"]["transaction_id"]["type"] == "integer"


def test_a_body_is_flattened_into_the_arguments():
    schema = input_schema(CATALOG["yieldo_corriger_transaction"])
    assert "transaction_id" in schema["properties"]
    assert "category_id" in schema["properties"]


def test_a_nested_body_keeps_its_inner_schema():
    schema = input_schema(CATALOG["yieldo_regler_cibles"])
    targets = schema["properties"]["targets"]
    assert targets["type"] == "array"
    assert "target_bps" in targets["items"]["properties"]


def test_the_payload_carries_a_stable_fingerprint():
    first = catalog_payload()
    assert re.fullmatch(r"[0-9a-f]{64}", first["fingerprint"])
    assert first == catalog_payload()
    assert {tool["name"] for tool in first["tools"]} == set(CATALOG)
