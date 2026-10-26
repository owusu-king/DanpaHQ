"""Cursor pagination.

Offset pagination breaks in exactly the situation this product creates: a tenant
scrolling a listings feed while new listings are being published. Page 2 then
repeats or skips rows. Cursor pagination over a stable ordering does not, and it
stays O(1) as the table grows.
"""

from __future__ import annotations

from rest_framework.pagination import CursorPagination


class StandardCursorPagination(CursorPagination):
    page_size = 20
    max_page_size = 100
    page_size_query_param = "page_size"
    ordering = "-created_at"
    cursor_query_param = "cursor"
