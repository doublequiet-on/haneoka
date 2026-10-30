-- Seeded forums carried a filler description; an empty object shows none.
UPDATE community_forum SET descriptions_json = '{}' WHERE descriptions_json = '{"ja":"この板の話題を投稿できます。","en":"Discuss this topic here.","zh-TW":"在此討論這個主題。","zh-CN":"在此讨论这个主题。","ko":"이 주제를 이야기하세요."}';
