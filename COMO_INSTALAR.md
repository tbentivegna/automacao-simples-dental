# Como colocar esse robô no ar (passo a passo simples)

Este é o serviço que vai abrir o Simples Dental num navegador escondido e
verificar horários disponíveis. Por enquanto ele só "olha" a tela — ainda
não clica em nada de agendamento de verdade. Isso é proposital: primeiro
validamos que o robô consegue entrar e enxergar a agenda direito.

## Passo 1 — Colocar o código no GitHub

O GitHub é como uma "pasta na nuvem" onde o código fica guardado. O
Easypanel vai puxar o código de lá.

1. Crie uma conta grátis em https://github.com (se ainda não tiver).
2. Crie um repositório novo, por exemplo `automacao-simples-dental`.
   Marque como **privado** (só você vai ter acesso).
3. Suba todos os arquivos desta pasta para esse repositório. Se você
   nunca fez isso, o próprio GitHub mostra um botão "Add file > Upload
   files" onde dá pra arrastar os arquivos direto pelo navegador, sem
   precisar usar comandos.

**Importante:** nunca suba o arquivo `.env` de verdade (com usuário e
senha reais) para o GitHub. Ele já está listado no `.gitignore` para
não ser enviado por engano.

## Passo 2 — Criar o serviço no Easypanel

1. Entre no Easypanel do seu servidor.
2. Clique em criar um novo serviço/app (geralmente um botão do tipo
   "+ Create" ou "New Service").
3. Escolha a opção de conectar com o **GitHub** e selecione o
   repositório que você criou no Passo 1.
4. O Easypanel vai reconhecer o `Dockerfile` automaticamente e usar ele
   para montar o robô — você não precisa digitar comandos.

## Passo 3 — Configurar as variáveis (usuário, senha, endereço)

Dentro das configurações desse novo app no Easypanel, procure a aba de
**Environment Variables** (variáveis de ambiente) e adicione:

| Nome | Valor |
|---|---|
| `SIMPLES_DENTAL_URL` | o endereço da tela de login do Simples Dental |
| `SIMPLES_DENTAL_USER` | o usuário de login |
| `SIMPLES_DENTAL_PASS` | a senha de login |
| `PORT` | `3000` |

Isso evita deixar usuário e senha escritos direto no código.

## Passo 4 — Guardar a sessão de login (evitar logar toda hora)

Nas configurações do app, procure a opção de **Volumes** (armazenamento
permanente) e crie um volume apontando a pasta `/app/auth` do
container para um espaço em disco permanente. Isso faz o robô lembrar
que já está logado, em vez de fazer login do zero a cada chamada.

## Passo 5 — NÃO ativar domínio público

Esse serviço não precisa (e não deve) ter um endereço acessível pela
internet. Ele só precisa ser chamado por dentro do próprio servidor,
pelo n8n. Deixe a opção de domínio/URL pública desativada — só o n8n
continua exposto como já está hoje.

## Passo 6 — Testar se está no ar

Depois do deploy, dentro do próprio Easypanel geralmente dá pra abrir
um "terminal" do serviço, ou você pode testar direto de dentro do n8n
com uma chamada HTTP para:

```
http://automacao-simples-dental:3000/health
```

(o nome antes dos dois-pontos é o nome que você deu ao serviço no
Easypanel — ajuste se for diferente). Se responder `{"status":"ok"}`,
o robô está de pé.

## Passo 7 — O que falta preencher

No arquivo `server.js` existem alguns trechos marcados com `TODO`. Eles
são os pontos exatos onde o robô precisa saber:

- Como reconhecer a tela de login;
- Onde clicar para entrar;
- Como reconhecer que já está logado;
- Onde ficam os horários disponíveis na agenda.

Assim que você me mandar um print (ou o HTML) da tela de login e da
tela de agenda do Simples Dental, eu preencho essas partes com os
seletores certos.
