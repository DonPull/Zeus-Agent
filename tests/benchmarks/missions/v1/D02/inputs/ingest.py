import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--db', required=True)
parser.add_argument('--input', required=True)
parser.parse_args()
raise NotImplementedError('Implement the non-destructive migration and idempotent import')
