# whohasaccess

[English](README.md) · Português · [日本語](README.ja.md)

O freelancer do ano passado ainda tem admin. Uma deploy key com permissão de escrita não é usada há 200 dias. Um webhook manda seus eventos de push por http sem criptografia. O **whohasaccess** encontra essas coisas em todos os seus repositórios em segundos, sem alterar nada.

```bash
npx @guihakka2/whohasaccess                 # todos os repositórios que você é dono
npx @guihakka2/whohasaccess --org minha-empresa
```

- **Colaboradores externos**: admin é alto, escrita é médio.
- **Convites pendentes** há mais de 7 dias.
- **Deploy keys**: chaves com escrita, chaves paradas há mais de 90 dias (`--stale`).
- **Webhooks**: sem https, com a checagem de TLS desligada, falhando ou inativos (só o host da URL aparece, porque o caminho costuma ter segredos).
- **Organizações**: membros sem 2FA, donos da org, GitHub Apps com escrita em todos os repositórios.

Usa o login do GitHub CLI (`gh auth login`) ou `GH_TOKEN`. **Só leitura** (apenas requisições GET), e o token nunca é mostrado. Opções: `--org`, `--all`, `--fail-on`, `--stale`, `--json`. Segurança: [SECURITY.md](SECURITY.md).
