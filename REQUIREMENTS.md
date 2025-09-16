# Requirements

- Allow users to configure the threshold for when conversation history is considered too large. The default limit should be extremely high to accommodate long sessions, but it must remain adjustable.
- When reasoning-oriented models are selected, expect a higher time to first token and account for it in any timeout or progress handling.
- Provide an option for the user to select which model is used for generation.
- Store both the default system prompt and default slash-command prompts in the database. Users may edit these prompts, and any changes must persist to the database.
