def flatten_dict(d, parent_key='', sep='.'):
    """
    Flattens a nested dictionary into a single-level dictionary.
    Keys are joined by `sep`. Nested lists should be indexed by integer indices.
    """
    items = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else str(k)
        if isinstance(v, dict):
            items.extend(flatten_dict(v, new_key, sep=sep).items())
        elif isinstance(v, list):
            # BUG: Does not assign numeric index, causing collisions and missing nested keys
            for item in v:
                items.append((new_key, item))
        else:
            items.append((new_key, v))
    return dict(items)
