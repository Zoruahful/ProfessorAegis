# Contributing

ProfessorAegis is a discontinued prototype, but forks and focused improvements are welcome.

Recommended workflow:

1. Fork the repository.
2. Create a short feature branch.
3. Copy `.env.example` to `.env` and use your own Discord application credentials.
4. Keep changes scoped to one fix or feature.
5. Run the relevant checks before opening a pull request.

Useful checks:

```bash
node --check index.js
node --check deploy-commands.js
python -m py_compile services/benchmarkWorker.py
```

Do not commit local `.env` files, generated databases, logs, `node_modules`, downloaded Pokemon icon caches, local Pokemon Showdown checkouts, backup archives, or private server data.
