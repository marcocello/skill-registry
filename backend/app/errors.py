from __future__ import annotations


class RegistryError(Exception):
    status = 400
    code = "REGISTRY_ERROR"

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ValidationError(RegistryError):
    code = "VALIDATION_ERROR"


class NotFoundError(RegistryError):
    status = 404
    code = "NOT_FOUND"


class ConflictError(RegistryError):
    status = 409
    code = "CONFLICT"


class UnauthorizedError(RegistryError):
    status = 401
    code = "UNAUTHORIZED"


class ForbiddenError(RegistryError):
    status = 403
    code = "FORBIDDEN"


class AuthModeDisabledError(RegistryError):
    status = 409
    code = "AUTH_MODE_DISABLED"
