# Avaliação de Colaboradores

App web para avaliação de colaboradores em 3 pilares (HardSkill, SoftSkill e Disciplina),
com gráficos de radar comparando cada pessoa à média do time e posicionamento em uma
matriz **Nine Box** (Potencial × Desempenho).

> App de testes. Hoje roda em **modo local** (dados salvos no navegador via `localStorage`).
> Quando as credenciais do Firebase forem preenchidas em `firebase-config.js`, passa a
> persistir no Firestore automaticamente.

## Estrutura

```
.
├── index.html          # Interface (sidebar: Time, Avaliação, Nine Box)
├── styles.css          # Estilos
├── firebase-config.js  # Config do Firebase (placeholders = modo local)
└── js/
    ├── model.js        # Pilares, competências e cálculos (regra de negócio)
    ├── store.js        # Persistência (localStorage ↔ Firebase)
    └── app.js          # UI, radares e Nine Box
```

## Rodar localmente

Basta abrir o `index.html` no navegador. Precisa de internet (o Chart.js vem via CDN).

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e suba estes arquivos.
2. No repositório: **Settings → Pages**.
3. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
4. Selecione a branch `main` e a pasta `/ (root)`. Salve.
5. Aguarde ~1 min. A URL será `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.

O arquivo `.nojekyll` garante que a pasta `js/` seja servida corretamente.

## Configuração (regras de negócio)

- Competências e descrições: `js/model.js` → array `PILLARS`.
- Fórmula dos eixos do Nine Box: `js/model.js` → `PERFORMANCE_WEIGHTS` e `POTENTIAL_WEIGHTS`.
  - Desempenho (horizontal) = média de HardSkill + Disciplina.
  - Potencial (vertical) = SoftSkill (Leadership Principles).
