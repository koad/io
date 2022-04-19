# koad:io

koad:io helps with tasks that you perform on a regular basis.


> warning: I am an amateur > all of this might be shit, it's too early to tell.


[![Matrix](src/assets/badges/matrix/io.svg)](https://matrix.to/#/#io:koad.sh?via=koad.sh)


by saving a task as a `command`, and saving the environment variables used is an `entity`,

- I can remember how I did a thing
- I can replay the thing I did
- I can go back and see if I was right
- I can keep my things together as simple files and folders
- I don't need to install or depend on complex tools and vendors
- I can keep my projects/data organized into categories (an entity folder for each `area of focus`)


## customizable chain reactions

when calling a koad:io command, there is a chain-reaction of steps that happen; this is where you can create and customize each command to run specific to the entity and/or the `current working directory`. 

- you call an entity wrapper, ie: `alice start`
- `alice` loads some general environment details, then calls the koad:io cli wrapper
	- `ENTITY=alice`   
	- `CURRENT_COMMAND=start`
	- `CWD=$PWD` (the directory in which the command is issued)
- koad:io cli wrapper loads some more specific environment details
	- `~/.koad-io/.env`   (if exists)  
	- `~/.$ENTITY/.env`   (if exists)  
	- `~/.$ENTITY/.credentials`   (if exists)  
- then, finds the most relevant regular command by searching in the following locations (and uses the results from the last location finds the command in).
- In each location, the deepest directory that contains either a `command.sh` file or a `$COMMAND_NAME.sh` file will used.
	- `~/.koad-io/commands/`  
	- `~/.$ENTITY/commands/`  
- checks the CURRENT_DIRECTORY 
	- `$CURRENT_DIRECTORY/commands/`  
- if a command of the same name is in the current directory	
	- use it instead: `./$COMMAND_NAME.sh`
	- load more environment vars 
		- `$CURRENT_DIRECTORY/.env`   (if exists)  
		- `$CURRENT_DIRECTORY/.credentials`   (if exists)  
- then calls the regular command with
	- environment details from the chain reaction
	- the remaining arguments passed into the entity cli wrapper

### examples

no1
```bash
alice probe domain koad.sh
```
is similar to 
```bash
set -a 
source ~/.koad-io/.env
source ~/.alice/.env
~/.koad-io/commands/probe/domain/command.sh koad.sh
```

no2
```bash
alice archive video https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
wraps to the command 
```bash
set -a 
source ~/.koad-io/.env
source ~/.alice/.env
~/.koad-io/commands/archive/video.sh https://www.youtube.com/watch?v=dQw4w9WgXcQ
```
> saves the results in the `~/.alice/archive/inbound` folder by default or will take a specified  folder within `~/.alice/.env/` as `KOAD_IO_ARCHIVE_FOLDER`

```env
KOAD_IO_ARCHIVE_FOLDER=$HOME/.alice/archive/inbound
```

## install

create the `~/.koad-io` folder with a clone of [this repo](https://github.com/koad/io)
```bash
git clone https://github.com/koad/io.git ~/.koad-io
```

add the `~/.koad-io/bin` folder to your path (add this to the end of your `~/.bashrc` file)
```bash
[ -d ~/.koad-io/bin ] && export PATH=$PATH:$HOME/.koad-io/bin
```

## create

> your first koad:io entity! 🤩 sooo exciting! 

```bash
koad-io init alice
```


alice will be created entirely in the .alice directory in your home directory
```bash
ls -la ~/.alice
```

> back this directory up NOW, and keep it __somewhere suuuuuper safe__.
> want to automated backups?  build a [raspberry pi powered concealment key-ring that also pretends to be your front door bell](https://duckduckgo.com).

Your entity's directory will be a basic bare/blank koad:io skeleton filled with directories and keys that will be handy for you if you ever decide you want your entity to exist among multiple devices and locations.

```bash
cd ~/.alice && ls -la
```
```bash
/bin
/etc
/usr
/lib
/var
/man
/ssl
/proc
/home
/hooks
/media
/archive
/keybase
/commands
/.env
```

You can ignore the overwhelming possibilities for now and focus on populating your commands folder with whatever creative thing you desire.

## create commands

bookmark [koad's bash cheatsheet](https://book.koad.sh/cheatsheets/bourn-again-scripting/) as it is a handy resource for creating new tasks/commands.


### global commands

> your first ever koad:io command! 😄 

inside ~/.koad-io/commands/
```bash
mkdir ~/.koad-io/commands/hello
cd ~/.koad-io/commands/hello
echo '
#!/usr/bin/env bash

echo "hi there, $ENTITY here!"
echo "args: $@"
'> command.sh
chmod +x command.sh
```

### run

inside ~/.koad-io/commands/hello using any entity
```bash
cd ~/.koad-io/commands/hello
alice command
alice command arg1 arg2 arg3 arg4
```

globally available using any entity
```bash
alice hello
alice hello arg1 arg2 arg3 arg4
```


## entity specific commands

commands can be specific to the entity

### create

inside ~/.alice/commands/
```bash
mkdir ~/.alice/commands/hello
cd ~/.alice/commands/hello
echo '
#!/usr/bin/env bash

echo "hi there, $ENTITY here!"
echo "args: $@"
'> command.sh
chmod +x command.sh
```

### run

inside ~/.alice/commands/hello using any entity
```bash
cd ~/.alice/commands/hello
alice command
alice command arg1 arg2 arg3 arg4
```

globally available using only alice
```bash
alice hello
alice hello arg1 arg2 arg3 arg4
```


## folder specific commands

You can use your entity's environment anywhere you want.

### create

inside ~/some/random/folder/
```bash
cd ~/some/random/folder/
echo '
#!/usr/bin/env bash

echo "hi there, $ENTITY here!"
echo "args: $@"
'> hello.sh
chmod +x hello.sh

```

### run

inside ~/some/random/folder/
```bash
cd ~/some/random/folder/
alice hello
alice hello arg1 arg2 arg3 arg4
```



## preload

check the commands folder to see what comes preloaded, not a lot.

- [/commands/init/README.md](/commands/init/README.md)  
- [/commands/whoami/README.md](/commands/whoami/README.md)  
- [/commands/example/README.md](/commands/example/README.md)  

language specific examples 

- [/commands/example/bash/README.md](/commands/example/bash/README.md)  
- [/commands/example/javascript/README.md](/commands/example/javascript/README.md)  
- [/commands/example/python/README.md](/commands/example/python/README.md)  
- [/commands/example/rust/README.md](/commands/example/rust/README.md)  
- [/commands/example/go/README.md](/commands/example/go/README.md)  

interact with the example command to see how things work
```bash
alice example
```
output
```
see how these examples work by taking a peek into the `~/.koad-io/commands/example` folder

this output is created by the file `~/.koad-io/commands/example/command.sh`

run other example commands, written to showcase various available languages

alice example bash
alice example javascript
alice example python
alice example rust
alice example go
```



## 🤝 Support

As mentioned above, I am an amateur; 

I have been using computers for a long time, programming for a long time; but, I totally suck in a lot of ways.  

> I'd appreciate any feedback from any seasoned `bash` users out there!  

Contributions, issues, and feature requests are welcome!  

Give a ⭐️ if you like this project!


P.S.  somebody somewhere, sometime, will create a voice controller for this,. so keep that in mind when creating commands.  You have full control, imagine if you were able to teach siri over time (for yourself);  it would be amazing.  


/koad