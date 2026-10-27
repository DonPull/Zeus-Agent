import re

class Version:
    def __init__(self, vstring):
        self.raw = vstring
        match = re.match(r"^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$", vstring)
        if not match:
            raise ValueError(f"Invalid semver: {vstring}")
        self.major = int(match.group(1))
        self.minor = int(match.group(2))
        self.patch = int(match.group(3))
        self.prerelease = match.group(4) or ""

    def __lt__(self, other):
        if (self.major, self.minor, self.patch) != (other.major, other.minor, other.patch):
            return (self.major, self.minor, self.patch) < (other.major, other.minor, other.patch)
        # BUG: A release version (no prerelease) should have higher precedence than a prerelease version!
        return self.prerelease < other.prerelease

    def __eq__(self, other):
        return (self.major, self.minor, self.patch, self.prerelease) == (other.major, other.minor, other.patch, other.prerelease)
