# `spawn` Command

## Overview

The `spawn` command is a powerful tool designed to quickly set up projects by deploying predefined templates, known as skeletons. It automates the process of copying skeleton structures into the current working directory and executing associated control scripts.

## Prerequisites

Before using the `spawn` command, ensure that:

- You have a Bash environment set up.
- The `.koad-io` directory, which contains skeletons, is properly set up in your home directory (`$HOME/.koad-io`).

## Usage

```bash
alice spawn <skeleton>
```

- `<skeleton>`: Name of the skeleton you want to deploy. This corresponds to a directory within `$HOME/.koad-io/skeletons/`.

## Command Breakdown

1. **Argument Check**: The script checks if a skeleton name is provided. If not, it displays usage information and exits.

2. **Environment Setup**: Sets up necessary environment variables like `CURRENTDATETIME` and `DATADIR`.

3. **Skeleton Path Resolution**: Determines the path to the specified skeleton and checks if it exists.

4. **Pre-Install Script Execution**: If a `pre-install` script is found in the skeleton's `control` directory, it is executed before the skeleton is deployed.

5. **Skeleton Deployment**: Copies the contents of the skeleton's `skeleton` directory to the current working directory.

6. **Install Script Execution**: Executes an `install` script from the skeleton's `control` directory, if it exists.

7. **Post-Install Script Execution**: Runs a `post-install` script, if present in the skeleton's `control` directory, after the skeleton deployment.

8. **Completion Message**: Indicates successful deployment of the skeleton.

## Example

Deploying a skeleton named `bare`:

```bash
alice spawn bare
```

This command will look for the `bare` skeleton in the `.koad-io/skeletons` directory, execute any control scripts, and copy its contents to your current directory.

## Notes

- Ensure that the skeleton name passed as an argument matches exactly with a directory under the `.koad-io/skeletons`.
- The control scripts (`pre-install`, `install`, `post-install`) are optional and skeleton-specific. They are not required for every skeleton but provide additional setup if included.

## Conclusion

The `spawn` command simplifies and streamlines the process of setting up new projects by utilizing predefined templates. Its integration of control scripts adds a layer of customization, allowing for more complex setup procedures to be automated.
