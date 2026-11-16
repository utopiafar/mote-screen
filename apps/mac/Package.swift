// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MoteScreen",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "MoteScreen", targets: ["MoteScreenApp"])
    ],
    targets: [
        .target(name: "MoteScreenCore"),
        .executableTarget(name: "MoteScreenApp", dependencies: ["MoteScreenCore"])
    ]
)
