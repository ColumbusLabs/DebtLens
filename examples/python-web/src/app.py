from flask import Blueprint

bp = Blueprint("billing", __name__)


@bp.get("/accounts")
def list_accounts():
    return "ok"


@bp.post("/accounts")
def create_account():
    return "ok"


@bp.get("/accounts/<account_id>")
def show_account(account_id):
    return "ok"


@bp.patch("/accounts/<account_id>")
def update_account(account_id):
    return "ok"


@bp.delete("/accounts/<account_id>")
def delete_account(account_id):
    return "ok"


@bp.post("/accounts/<account_id>/archive")
def archive_account(account_id):
    return "ok"


@bp.post("/accounts/<account_id>/restore")
def restore_account(account_id):
    return "ok"


@bp.get("/accounts/<account_id>/events")
def list_events(account_id):
    return "ok"


@bp.post("/accounts/<account_id>/events")
def create_event(account_id):
    return "ok"
