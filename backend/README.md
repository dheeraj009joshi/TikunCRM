# Backend

## Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

## Run Development Server

```bash
uvicorn app.main:app --reload --port 8000
```

## Run Migrations

```bash
alembic upgrade head
```

## Run Tests

```bash
pytest tests/ -v
```
# leeds_crm
