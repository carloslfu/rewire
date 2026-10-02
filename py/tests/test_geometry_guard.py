import pytest
from rewire.ref import Changes


def test_geometry_is_not_silently_ignored_by_recording_reference():
    with pytest.raises(NotImplementedError, match="Head geometry"):
        Changes.make({"geometry": [{"floor": 0, "head": 1, "kind": "rotate", "angle": 90, "seed": 1}]}, "cpu")
