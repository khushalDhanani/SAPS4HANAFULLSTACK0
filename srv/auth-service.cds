// CAP Authentication Service
// Validates credentials against actual S/4HANA Gateway
@(requires: 'any')
service AuthService {
    // Unrestricted login action — callable without prior authentication
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
