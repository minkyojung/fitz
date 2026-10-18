-- For the review and the OCR-error hunt (docs/agent.md §4), applied after gatsby.sql: errors planted in the source the
-- way OCR makes them, and translations to review, one with its meaning reversed. Not the prompt's own examples.
-- Planted OCR errors: tuming (turning), matures (natures, a real word), rnind (mind), unjust1y (unjustly).
-- Not an error: "any one" is Fitzgerald's spelling. Planted in the translation: ¶4 "서둘러 내리는" says the opposite
-- of "reserve all judgments".
UPDATE segment SET source_text = replace(source_text, 'turning over', 'tuming over'), source_doc = replace(source_doc, 'turning over', 'tuming over') WHERE id = 2;
UPDATE segment SET source_text = replace(source_text, 'curious natures', 'curious matures'), source_doc = replace(source_doc, 'curious natures', 'curious matures') WHERE id = 4;
UPDATE segment SET source_text = replace(source_text, 'abnormal mind', 'abnormal rnind'), source_doc = replace(source_doc, 'abnormal mind', 'abnormal rnind') WHERE id = 5;
UPDATE segment SET source_text = replace(source_text, 'unjustly', 'unjust1y'), source_doc = replace(source_doc, 'unjustly', 'unjust1y') WHERE id = 5;
UPDATE segment SET target_doc = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"“누군가를 비판하고 싶어질 때면,” 아버지는 내게 말씀하셨다. “이 세상 모든 사람이 다 너처럼 좋은 조건을 누리며 살아온 건 아니라는 걸 기억하렴.”"}]}]}', target_text = '“누군가를 비판하고 싶어질 때면,” 아버지는 내게 말씀하셨다. “이 세상 모든 사람이 다 너처럼 좋은 조건을 누리며 살아온 건 아니라는 걸 기억하렴.”', status = 'draft' WHERE id = 3;
UPDATE segment SET target_doc = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"아버지는 더 말씀하지 않으셨지만, 우리는 늘 말수 적은 방식으로 유난히 잘 통했고, 나는 그 말에 훨씬 많은 뜻이 담겨 있음을 알았다. 그래서 나는 모든 판단을 서둘러 내리는 버릇이 생겼는데, 이 버릇 덕분에 별난 사람들이 내게 마음을 열었고, 또 지겨운 사람들의 희생양이 되기도 했다."}]}]}', target_text = '아버지는 더 말씀하지 않으셨지만, 우리는 늘 말수 적은 방식으로 유난히 잘 통했고, 나는 그 말에 훨씬 많은 뜻이 담겨 있음을 알았다. 그래서 나는 모든 판단을 서둘러 내리는 버릇이 생겼는데, 이 버릇 덕분에 별난 사람들이 내게 마음을 열었고, 또 지겨운 사람들의 희생양이 되기도 했다.', status = 'draft' WHERE id = 4;
