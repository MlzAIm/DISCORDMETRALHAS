-- Execute uma vez no SQL Editor do projeto Supabase.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 2 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  username text not null,
  channel text not null check (channel in ('geral','memes','jogos')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.voice_room_members (
  room text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now(),
  primary key (room, user_id)
);

create extension if not exists pgcrypto with schema extensions;
create table if not exists public.app_invites (
  code_hash text primary key,
  uses_remaining integer not null check (uses_remaining between 0 and 15)
);
alter table public.app_invites enable row level security;
revoke all on public.app_invites from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

create policy "authenticated users can read profiles" on public.profiles
  for select to authenticated using (true);
create policy "users can create their own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "users can update their own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "authenticated users can read messages" on public.messages
  for select to authenticated using (true);
create policy "users can send as themselves" on public.messages
  for insert to authenticated with check (
    auth.uid() = author_id and username = (select p.username from public.profiles p where p.id = auth.uid())
  );

alter publication supabase_realtime add table public.messages;

-- Sinalização WebRTC efêmera. Só usuários autenticados podem publicar/ler
-- no tópico fixo da sala privada de voz.
create policy "authenticated members can receive MetralhaHub signals"
  on realtime.messages for select to authenticated
  using (topic = 'metralhahub-main-room');
create policy "authenticated members can send MetralhaHub signals"
  on realtime.messages for insert to authenticated
  with check (topic = 'metralhahub-main-room');

alter table public.voice_room_members enable row level security;

create or replace function public.join_voice_room(p_room text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  member_count integer;
  member_id uuid := auth.uid();
begin
  if member_id is null or p_room <> 'main' then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_room)::bigint);
  delete from public.voice_room_members where room = p_room and last_seen < now() - interval '90 seconds';
  select count(*) into member_count from public.voice_room_members where room = p_room;
  if exists (select 1 from public.voice_room_members where room = p_room and user_id = member_id) then
    update public.voice_room_members set last_seen = now() where room = p_room and user_id = member_id;
    return true;
  end if;
  if member_count >= 15 then return false; end if;
  insert into public.voice_room_members(room, user_id, last_seen) values (p_room, member_id, now());
  return true;
end;
$$;

create or replace function public.heartbeat_voice_room(p_room text)
returns void language sql security definer set search_path = '' as $$
  update public.voice_room_members set last_seen = now() where room = p_room and user_id = auth.uid();
$$;

create or replace function public.leave_voice_room(p_room text)
returns void language sql security definer set search_path = '' as $$
  delete from public.voice_room_members where room = p_room and user_id = auth.uid();
$$;

revoke all on function public.join_voice_room(text) from public;
revoke all on function public.heartbeat_voice_room(text) from public;
revoke all on function public.leave_voice_room(text) from public;
grant execute on function public.join_voice_room(text) to authenticated;
grant execute on function public.heartbeat_voice_room(text) to authenticated;
grant execute on function public.leave_voice_room(text) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  invite_hash text;
  invite_code text;
begin
  invite_code := btrim(coalesce(new.raw_user_meta_data ->> 'invite_code',''));
  select code_hash into invite_hash from public.app_invites
    where extensions.crypt(invite_code, code_hash) = code_hash and uses_remaining > 0
    limit 1 for update;
  if invite_hash is null then raise exception 'Código de convite inválido ou esgotado'; end if;
  update public.app_invites set uses_remaining = uses_remaining - 1 where code_hash = invite_hash;
  insert into public.profiles (id, username)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'username',''), split_part(new.email,'@',1)), 24));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();
