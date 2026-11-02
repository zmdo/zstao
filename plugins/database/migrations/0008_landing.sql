-- The page opened after sign-in. A missing value keeps the Harness conversation.
alter table console_site add column if not exists landing_page text not null default 'agent-chat';
