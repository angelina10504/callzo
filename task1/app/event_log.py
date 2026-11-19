import json
import logging
from time import perf_counter

logger = logging.getLogger("callzo.events")
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())
logger.setLevel(logging.INFO)
logger.propagate = False


def emit(action, result, started, *, level=logging.INFO, **fields):
    logger.log(level, json.dumps({
        "action": action, "result": result, "level": logging.getLevelName(level),
        "duration_ms": round((perf_counter() - started) * 1000, 2), **fields,
    }))
