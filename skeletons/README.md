# Seletons

The skeletons folder in a koad/io installation is a directory that contains template projects or project structures, which serve as starting points for new projects. These templates, often referred to as "skeletons," provide a predefined set of files, directories, and configurations that can be customized and built upon.

```bash
~/.koad-io/skeletons/
```


## Use a skeleton

To use the skeletons in koad/io, you can leverage the `spawn` command. When you run the `spawn` command with the name of a skeleton, it creates a new project in the current working directory based on that skeleton. The `spawn` command copies the files and directories from the skeleton into your project, allowing you to start with a preconfigured project structure.

```bash
cd ~/workbench/some-random-folder/
alice spawn bare
```

or

```bash
cd ~/workbench/some-random-folder/
alice spawn bare
```


The skeletons in the koad/io ecosystem can be diverse and cover various project types and technologies. For example, there may be skeletons for an Express.js API, a Gnome extension, a browser extension, a simple website, a PDF design for print, an MkDocs documentation project, a progressive web app, or a Node.js worker, among others.

By using skeletons, you can save time and effort in setting up the initial structure of your projects. They provide a foundation with predefined files and configurations that align with specific project types or frameworks. You can then focus on customizing and extending the skeleton to meet your project requirements, rather than starting from scratch.

The skeletons folder within your koad/io installation serves as a repository of these templates. You can add, modify, or remove skeletons in this folder to create your own set of customized starting points. Additionally, the skeletons can include a `hook.sh` file, which is executed during the `spawn` command. This allows the skeleton to perform additional setup or customization steps specific to the project being spawned.

```bash
~/.koad-io/skeletons/example-skeleton/hook.sh
```

Overall, the skeletons feature in koad/io provides a convenient way to bootstrap new projects with predefined structures and configurations, enabling faster development and maintaining consistency across your projects.

