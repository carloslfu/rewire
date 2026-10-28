import pytest
import torch

from rewire.persona import hook_for, target_mask


def test_neuron_push_is_confined_to_selected_rows_units_and_layers():
    act = torch.arange(2 * 3 * 3072, dtype=torch.float32).reshape(2, 3, 3072)
    original = act.clone()
    hook = hook_for([[{"floor": 4, "unit": 9, "delta": 2.5}],
                     [{"floor": 4, "unit": 20, "delta": -3}, {"floor": 7, "unit": 8, "delta": 4}]], "cpu")
    expected = original.clone()
    expected[0, :, 9] += 2.5
    expected[1, :, 20] -= 3
    assert torch.equal(hook(4, act), expected)
    assert torch.equal(act, original)
    assert hook(3, act) is act
    assert torch.equal(hook_for([[], []], "cpu")(4, act), original)


def test_single_neuron_addition_equals_its_down_projection_column():
    torch.manual_seed(3)
    act = torch.randn(2, 4, 3072)
    down = torch.randn(5, 3072)
    hook = hook_for([[{"floor": 4, "unit": 9, "delta": 2.5}], []], "cpu")
    measured = hook(4, act) @ down.T - act @ down.T
    expected = torch.zeros_like(measured)
    expected[0] = 2.5 * down[:, 9]
    torch.testing.assert_close(measured, expected, atol=5e-5, rtol=5e-5)


def test_response_logprob_mask_includes_first_token_and_excludes_padding():
    assert target_mask([3, 4], [6, 5], 6).tolist() == [
        [False, False, True, True, True, False],
        [False, False, False, True, False, False],
    ]


def test_bad_addresses_fail():
    with pytest.raises(ValueError, match="address"):
        hook_for([[{"floor": 28, "unit": 0, "delta": 1}]], "cpu")
