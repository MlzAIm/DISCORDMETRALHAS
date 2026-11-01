# MetralhaHub

Aplicativo de desktop para um grupo privado pequeno. O projeto usa Electron para gerar um instalador Windows e Supabase para contas, mensagens e sinalização WebRTC. Voz e compartilhamento de tela são enviados diretamente entre os participantes (P2P); não há servidor de mídia.

## Preparar o backend gratuito

1. Crie um projeto no Supabase Free e abra o **SQL Editor**.
2. Execute todo o conteúdo de `backend/schema.sql` uma única vez.
3. Crie o primeiro código de convite no SQL Editor. Troque o texto de exemplo por um código que você compartilhará apenas com seus amigos:

   ```sql
   insert into public.app_invites (code_hash, uses_remaining)
   values (extensions.crypt('TROQUE-POR-UM-CODIGO-PRIVADO', extensions.gen_salt('bf')), 14);
   ```

4. Em **Project Settings → API**, copie a Project URL e a chave publicável (`anon`/`publishable`). Coloque os valores em `config.js`:

   ```js
   window.METRALHA_CONFIG = {
     supabaseUrl: 'https://SEU-PROJETO.supabase.co',
     supabaseAnonKey: 'SUA-CHAVE-PUBLICAVEL'
   };
   ```

   A chave publicável pode ficar no app. Nunca use a `service_role` key.
5. No Supabase Auth, desligue a confirmação de e-mail para o primeiro teste com o grupo, ou configure um provedor SMTP antes de distribuir o app. Cada amigo cria a conta informando o código privado.

O plano grátis do Supabase pode pausar o projeto após uma semana com pouca atividade. Ao pausar, o backend deixa de responder até ser reativado no painel.

## Gerar o instalador para Windows

Instale Node.js LTS e, nesta pasta, execute:

```powershell
npm install
npm run dist
```

O instalador ficará em `release/`. Envie esse arquivo aos amigos; depois de instalar, eles entram com as próprias contas e o código de convite. O Windows pode exibir um aviso de editor desconhecido porque o instalador não tem assinatura paga.

## Chamadas e limite de participantes

O limite de 15 participantes é controlado por uma função transacional no banco, com heartbeat para liberar lugares quando alguém fecha o app. O áudio e a tela usam conexão WebRTC direta. Essa arquitetura não paga um SFU, mas cada PC envia mídia a cada participante; com 15 pessoas, a chamada e principalmente a tela compartilhada podem exigir bastante upload. Redes com NAT restritivo podem precisar de TURN; sem um serviço TURN autorizado/gratuito, algumas conexões podem falhar.

O arquivo `config.js` contém a URL e chave publicável do backend, não segredos administrativos. Mantenha o código de convite privado. Contas e mensagens são gerenciadas pelo Supabase, não armazenadas apenas neste PC.
