from app.run_lock import acquire_lock, lock_exists, release_lock


def test_lock_behavior(tmp_path):
    lock_path = tmp_path / "run.lock"
    assert acquire_lock(lock_path, "run-1") is True
    assert lock_exists(lock_path) is True
    assert acquire_lock(lock_path, "run-2") is False
    release_lock(lock_path)
    assert lock_exists(lock_path) is False
