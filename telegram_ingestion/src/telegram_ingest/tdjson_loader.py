from __future__ import annotations

import ctypes
import ctypes.util
import importlib.util
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

__all__ = ["TdJsonBindings", "load_tdjson", "resolve_tdjson_path"]

_DLL_NAMES = ("tdjson.dll", "libtdjson.dll")
_DLL_GLOB_PATTERNS = ("tdjson*.dll", "libtdjson*.dll")
_ENV_PATH_VARS = ("TDLIB_LIBRARY_PATH", "TDJSON_LIBRARY_PATH", "TDLIB_TDJSON_PATH")
_ENV_DIR_VARS = ("TDLIB_LIBRARY_DIR", "TDJSON_LIBRARY_DIR", "TDLIB_DIR", "TDLIB_HOME")


@dataclass(frozen=True, slots=True)
class TdJsonBindings:
    library: ctypes.CDLL
    library_path: Path
    create_client: Any
    destroy_client: Any
    send: Any
    receive: Any
    execute: Any
    set_log_verbosity_level: Any | None = None
    set_log_file_path: Any | None = None
    dll_directory_handles: tuple[Any, ...] = ()


def _iter_library_candidates(directory: Path) -> tuple[Path, ...]:
    if not directory.is_dir():
        return ()

    candidates: list[Path] = []
    for name in _DLL_NAMES:
        possible = directory / name
        if possible.exists():
            candidates.append(possible.resolve())
    for pattern in _DLL_GLOB_PATTERNS:
        for possible in sorted(directory.glob(pattern)):
            if possible.is_file():
                resolved = possible.resolve()
                if resolved not in candidates:
                    candidates.append(resolved)
    return tuple(candidates)


def _discover_packaged_tdjson_directory() -> Path | None:
    spec = importlib.util.find_spec("tdjson")
    if spec is None or spec.origin is None:
        return None

    package_dir = Path(spec.origin).resolve().parent
    bundled_dir = package_dir.parent / "tdjson.libs"
    if bundled_dir.exists():
        return bundled_dir
    return None


def resolve_tdjson_path(explicit_path: str | os.PathLike[str] | None = None) -> Path:
    candidates: list[Path] = []

    def add_candidate(value: str | os.PathLike[str] | None) -> None:
        if not value:
            return
        candidate = Path(value).expanduser()
        if candidate.is_file():
            candidates.append(candidate.resolve())
        elif candidate.is_dir():
            candidates.extend(_iter_library_candidates(candidate))

    add_candidate(explicit_path)
    for env_name in _ENV_PATH_VARS:
        add_candidate(os.getenv(env_name))

    for env_name in _ENV_DIR_VARS:
        directory = os.getenv(env_name)
        if not directory:
            continue
        base = Path(directory).expanduser()
        if base.is_file():
            candidates.append(base.resolve())
            continue
        candidates.extend(_iter_library_candidates(base))

    module_dir = Path(__file__).resolve().parent
    project_dir = module_dir.parent
    repo_dir = project_dir.parent
    search_dirs = (
        Path.cwd(),
        module_dir,
        project_dir,
        repo_dir,
        project_dir / "bin",
        project_dir / "lib",
        repo_dir / "bin",
        repo_dir / "lib",
        repo_dir.parent,
        repo_dir.parent / "bin",
        repo_dir.parent / "lib",
    )
    for directory in search_dirs:
        candidates.extend(_iter_library_candidates(directory))

    packaged_dir = _discover_packaged_tdjson_directory()
    if packaged_dir is not None:
        candidates.extend(_iter_library_candidates(packaged_dir))

    found_library = ctypes.util.find_library("tdjson")
    if found_library:
        add_candidate(found_library)

    if not candidates:
        searched = ", ".join(str(path) for path in search_dirs)
        raise FileNotFoundError(
            "Unable to locate tdjson.dll. Set TDLIB_LIBRARY_PATH to the full DLL path "
            f"or TDLIB_LIBRARY_DIR to the directory containing it. Searched: {searched}"
        )

    # Prefer the first match in the search order.
    return candidates[0]


def _configure_windows_dll_search(library_path: Path) -> tuple[Any, ...]:
    handles: list[Any] = []
    if os.name != "nt":
        return tuple(handles)

    add_dll_directory = getattr(os, "add_dll_directory", None)
    if add_dll_directory is None:
        return tuple(handles)

    for directory in {library_path.parent, library_path.parent.parent}:
        if directory.exists():
            handles.append(add_dll_directory(str(directory)))
    return tuple(handles)


def load_tdjson(explicit_path: str | os.PathLike[str] | None = None) -> TdJsonBindings:
    library_path = resolve_tdjson_path(explicit_path)
    dll_directory_handles = _configure_windows_dll_search(library_path)
    try:
        library = ctypes.CDLL(str(library_path))
    except OSError as exc:
        raise OSError(
            f"Failed to load TDLib JSON library from {library_path}. "
            "Check that tdjson.dll and its dependent DLLs are present and that the "
            "directory is on PATH or provided via TDLIB_LIBRARY_PATH / TDLIB_LIBRARY_DIR."
        ) from exc

    create_client = library.td_json_client_create
    create_client.restype = ctypes.c_void_p
    create_client.argtypes = []

    destroy_client = library.td_json_client_destroy
    destroy_client.restype = None
    destroy_client.argtypes = [ctypes.c_void_p]

    send = library.td_json_client_send
    send.restype = None
    send.argtypes = [ctypes.c_void_p, ctypes.c_char_p]

    receive = library.td_json_client_receive
    receive.restype = ctypes.c_void_p
    receive.argtypes = [ctypes.c_void_p, ctypes.c_double]

    execute = library.td_json_client_execute
    execute.restype = ctypes.c_void_p
    execute.argtypes = [ctypes.c_char_p]

    set_log_verbosity_level = getattr(library, "td_set_log_verbosity_level", None)
    if set_log_verbosity_level is not None:
        set_log_verbosity_level.restype = None
        set_log_verbosity_level.argtypes = [ctypes.c_int]

    set_log_file_path = getattr(library, "td_set_log_file_path", None)
    if set_log_file_path is not None:
        set_log_file_path.restype = ctypes.c_int
        set_log_file_path.argtypes = [ctypes.c_char_p]

    return TdJsonBindings(
        library=library,
        library_path=library_path,
        create_client=create_client,
        destroy_client=destroy_client,
        send=send,
        receive=receive,
        execute=execute,
        set_log_verbosity_level=set_log_verbosity_level,
        set_log_file_path=set_log_file_path,
        dll_directory_handles=dll_directory_handles,
    )
