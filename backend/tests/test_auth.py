from app.db.base import Session, User


def test_login_sets_session_cookie_and_persists_session(client, db_session):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@passark.local", "password": "change-me-now"},
    )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "admin@passark.local"
    assert "passark_session" in response.cookies

    stored_user = db_session.query(User).filter_by(email="admin@passark.local").one()
    stored_session = db_session.query(Session).filter_by(user_id=stored_user.id).one()
    assert stored_session.token == response.cookies["passark_session"]
    assert stored_session.invalidated_at is None


def test_invalid_login_returns_stable_401_contract(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@passark.local", "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }


def test_anonymous_protected_access_is_rejected(client):
    response = client.get("/api/v1/protected/whoami")

    assert response.status_code == 401
    assert response.json() == {
        "detail": {
            "code": "auth_unauthenticated",
            "message": "Authentication required.",
        }
    }


def test_authenticated_protected_access_succeeds(client):
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@passark.local", "password": "change-me-now"},
    )
    assert login_response.status_code == 200

    response = client.get("/api/v1/protected/whoami")

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "admin@passark.local"
    assert body["session_id"] > 0


def test_logout_invalidates_the_session(client, db_session):
    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@passark.local", "password": "change-me-now"},
    )
    session_token = login_response.cookies["passark_session"]

    logout_response = client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 204

    stored_session = db_session.query(Session).filter_by(token=session_token).one()
    assert stored_session.invalidated_at is not None

    response = client.get("/api/v1/protected/whoami")
    assert response.status_code == 401
