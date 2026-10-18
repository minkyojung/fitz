-- A tiny book for recording agent fixtures: the opening of The Great Gatsby (1925, public domain in the US).
-- Committed recordings are made against this, never against the book being translated.
INSERT INTO book(id, title, author, source_pdf) VALUES (1, 'The Great Gatsby', 'F. Scott Fitzgerald', '/nowhere/gatsby.pdf');
INSERT INTO chapter(id, book_id, idx, title, start_page) VALUES (1, 1, 0, 'Chapter I', 1);
INSERT INTO segment(id, chapter_id, idx, kind, page_start, page_end, source_doc, source_text, target_doc, target_text, status) VALUES
  (1, 1, 0, 'heading', 1, 1,
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Chapter I"}]}]}', 'Chapter I',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"1장"}]}]}', '1장', 'reviewed'),
  (2, 1, 1, 'paragraph', 1, 1,
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"In my younger and more vulnerable years my father gave me some advice that I''ve been turning over in my mind ever since."}]}]}',
   'In my younger and more vulnerable years my father gave me some advice that I''ve been turning over in my mind ever since.',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"지금보다 어리고 쉽게 상처받던 시절, 아버지가 내게 해 주신 충고가 있는데 나는 그 뒤로 줄곧 그 말을 곱씹어 왔다."}]}]}',
   '지금보다 어리고 쉽게 상처받던 시절, 아버지가 내게 해 주신 충고가 있는데 나는 그 뒤로 줄곧 그 말을 곱씹어 왔다.', 'draft'),
  (3, 1, 2, 'paragraph', 1, 1,
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven''t had the advantages that you''ve had.”"}]}]}',
   '“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven''t had the advantages that you''ve had.”',
   NULL, NULL, 'untranslated'),
  (4, 1, 3, 'paragraph', 1, 1,
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"He didn''t say any more, but we''ve always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that. In consequence, I''m inclined to reserve all judgments, a habit that has opened up many curious natures to me and also made me the victim of not a few veteran bores."}]}]}',
   'He didn''t say any more, but we''ve always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that. In consequence, I''m inclined to reserve all judgments, a habit that has opened up many curious natures to me and also made me the victim of not a few veteran bores.',
   NULL, NULL, 'untranslated'),
  (5, 1, 4, 'paragraph', 1, 1,
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"The abnormal mind is quick to detect and attach itself to this quality when it appears in a normal person, and so it came about that in college I was unjustly accused of being a politician, because I was privy to the secret griefs of wild, unknown men."}]}]}',
   'The abnormal mind is quick to detect and attach itself to this quality when it appears in a normal person, and so it came about that in college I was unjustly accused of being a politician, because I was privy to the secret griefs of wild, unknown men.',
   NULL, NULL, 'untranslated');
INSERT INTO glossary(book_id, term, translation, aliases, kind) VALUES (1, 'Gatsby', '개츠비', NULL, 'person');
INSERT INTO comment(id, segment_id, side, src_exact, src_prefix, src_suffix, src_start, src_end, body) VALUES
  (1, 4, 'source', 'reserve all judgments', 'inclined to ', ', a habit', 181, 202, '앞 문장의 reserved와 말장난? 둘을 같은 말로 받을지 고민');
