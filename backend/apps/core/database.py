"""Resolve installed extension schemas for Django's public-schema application."""


def extension_search_path(cursor):
    cursor.execute(
        "SELECT DISTINCT n.nspname FROM pg_extension e "
        "JOIN pg_namespace n ON n.oid=e.extnamespace "
        "WHERE e.extname IN ('postgis', 'pg_trgm', 'btree_gist') "
        "AND n.nspname <> 'public' ORDER BY n.nspname"
    )
    return ["public", *(row[0] for row in cursor.fetchall())]


def configure_extension_search_path(*, connection, **kwargs):
    if connection.vendor != "postgresql":
        return
    # Explicit session setup also works when a pooler ignores startup options
    # or reuses a server connection created before role defaults were changed.
    with connection.cursor() as cursor:
        schemas = extension_search_path(cursor)
        path = ", ".join(connection.ops.quote_name(schema) for schema in schemas)
        cursor.execute("SELECT pg_catalog.set_config('search_path', %s, false)", [path])
