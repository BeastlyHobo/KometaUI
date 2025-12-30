from app.config_store import validate_yaml


def test_validate_yaml_ok():
    ok, details = validate_yaml("libraries: {}")
    assert ok is True
    assert details == {}


def test_validate_yaml_invalid():
    ok, details = validate_yaml("libraries: [")
    assert ok is False
    assert "error" in details


def test_validate_yaml_root_type():
    ok, details = validate_yaml("- item")
    assert ok is False
    assert details["error"] == "YAML root must be a mapping"
