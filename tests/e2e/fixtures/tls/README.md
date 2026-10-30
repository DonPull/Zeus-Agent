These are public development-only credentials for the isolated loopback HTTPS
mock. They are not service/user credentials. The test executable trusts only
the fixture CA, only in explicitly enabled offline mode. Normal production
certificate verification is unchanged. The server uses a separate leaf
certificate for localhost/127.0.0.1; the CA key is not required by tests.
