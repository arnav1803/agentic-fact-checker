"""Make the parent package (fact_checker.py, config.py, models.py …) importable
from inside evals/, and ensure the project .env is loaded."""
import os
import sys

PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PARENT not in sys.path:
    sys.path.insert(0, PARENT)

# Load fact_checker_simple/.env regardless of the current working directory
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(PARENT, ".env"))
except Exception:
    pass
