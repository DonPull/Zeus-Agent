"""Return actual function results; expected answers stay in the controller."""
import copy
import importlib.util
import json
import sys

implementation, function = sys.argv[1:3]
spec = importlib.util.spec_from_file_location('submission', implementation)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = json.load(sys.stdin)
output = []
for arguments in cases:
    arguments = copy.deepcopy(arguments)
    try:
        returned = getattr(module, function)(*arguments)
        output.append({'returned': returned, 'after': arguments})
    except Exception as error:
        output.append({'error': type(error).__name__, 'message': str(error)[:200]})
print(json.dumps(output, allow_nan=False))
