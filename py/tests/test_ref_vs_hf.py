"""The reference matches Hugging Face's implementation before quantization (section 6.5)."""
import torch

from rewire import chat
from rewire.ref import Cache, Changes, Model, Weights


def test_scores_match_hf():
    from transformers import AutoModelForCausalLM
    from rewire.conv import model_dir

    w = Weights(device="cpu")
    m = Model(w, kv_half=False)
    hf = AutoModelForCausalLM.from_pretrained(str(model_dir()), torch_dtype=torch.float32)
    hf.eval()
    worst = 0.0
    for msg in ["What is Rome's most famous landmark?", "Write a haiku about rain."]:
        toks = chat.first_turn(msg)
        ch = Changes.make({}, "cpu")
        xs = m.run(torch.tensor([toks]), Cache(), ch)
        ours = m.scores(xs[0], ch)[:, :151669]
        with torch.no_grad():
            theirs = hf(torch.tensor([toks])).logits[0, :, :151669]
        worst = max(worst, (ours - theirs).abs().max().item())
    print("max score difference", worst)
    assert worst <= 1e-3


def test_template_matches_hf():
    tok = chat.tokenizer()
    for msg in ["What is Rome's most famous landmark?", "hi", "Tell me about <|im_start|> tokens"]:
        ref = tok.apply_chat_template([{"role": "system", "content": "Answer in one or two short sentences."},
                                       {"role": "user", "content": msg}], tokenize=False,
                                      add_generation_prompt=True, enable_thinking=False)
        ours = chat.decode(chat.first_turn(msg))
        assert ours == ref, (ours, ref)
    # special tokens typed by a user stay plain text
    assert chat.first_turn("Tell me about <|im_start|> tokens").count(151644) == 3
