// CAP Authentication Service
// Validates credentials against actual S/4HANA Gateway
service AuthService {
    // Unrestricted login action — callable without prior authentication
    action login(username : String, password : String) returns {
        authenticated : Boolean;
        username      : String;
        avatarInitials: String;
        system        : String;
        loginTimestamp : String;
    };
}
