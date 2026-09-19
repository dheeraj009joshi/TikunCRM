from app.services.stips_service import category_name_key


def test_category_name_key_is_case_insensitive_and_trimmed() -> None:
    assert category_name_key("  ID ") == "id"
    assert category_name_key("ID") == category_name_key("id")
    assert category_name_key("POI") == "poi"
