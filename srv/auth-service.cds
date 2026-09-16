// CAP Authentication Service
@(requires: 'any')
service AuthService {
    // Returns session information for the current user (XSUAA in deployed environments, dev user in local dev)
    function getUserInfo() returns {
        authenticated : Boolean;
        message       : String;
        username      : String;
        avatarInitials: String;
        system        : String;
        loginTimestamp: String;
        token         : String;
        scopes        : array of String;
    };

    // Custom login action — strictly gated to local development when dev issuer is opted-in.
    // Disabled in deployed environments (HTTP 403) where XSUAA is enforced.
    action login(username : String, password : String) returns {
        authenticated : Boolean;
        message       : String;
        username      : String;
        avatarInitials: String;
        system        : String;
        loginTimestamp: String;
        token         : String;
        scopes        : array of String;
    };
}
