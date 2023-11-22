# Packages Folder

The `packages` folder in a koad:io installation contains user interface components and packages designed to be used with the Meteor framework and Blaze templating engine. These packages provide pre-built UI elements and functionality that can be easily integrated into your koad:io projects.

## Purpose

The purpose of the `packages` folder is to enhance the user interface and user experience of your koad:io applications. These packages offer a range of UI components, such as forms, buttons, menus, modals, and more. They are designed to work seamlessly with the Meteor framework, making it easier to build interactive and responsive user interfaces.

## Integration with Meteor

To use the packages in the `packages` folder, you need to set the environment variable `METEOR_PACKAGES` to point to the location of the `packages` directory. By default, this directory is located at `~/.koad-io/packages`. You can modify this location based on your preferences or project requirements.

Once you have set the `METEOR_PACKAGES` environment variable, Meteor can access the packages in the `packages` directory and include them in your koad:io applications. These packages are written in Meteor's package system and utilize the Blaze templating engine, which allows for seamless integration with your application's UI.

## Usage

To utilize the packages in your koad:io projects, you can import the desired packages in your JavaScript files and use the provided Blaze templates and UI components within your application's templates. The package documentation and examples can guide you on how to effectively integrate and utilize each specific package.

It's worth noting that the packages in the `packages` folder are optional and can be used based on your project's needs. You can selectively include the packages that provide the desired functionality for your application. Feel free to explore the available packages, experiment with different UI elements, and customize them to fit your project's requirements.

## Contribution and Customization

The `packages` folder is extensible, allowing you to create and add your own custom packages or modify existing ones. If you have UI components or functionality that you frequently use in your koad:io projects, you can create a custom package and place it in the `packages` directory. This enables you to reuse your custom UI elements across multiple projects and maintain consistency in your application's design.

If you wish to contribute to the koad:io project by creating or enhancing existing packages, you are encouraged to do so. You can submit your package contributions through pull requests to the official koad:io repository, making them available for other users to benefit from.

## License

The individual packages in this directory may have their own licensing terms, which can usually be found in their respective README files. Please review the licensing information for each package before using them in your projects.

