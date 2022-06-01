# koad:io

<!-- for that whom may have an eye to see -->
An organizational tool for your mind's eye.

---

> warning: I am an amateur > all of this might be shit, it's too early to tell.


[![Matrix](assets/matrix.svg)](https://matrix.to/#/#io:koad.sh?via=koad.sh)

## reason

>
> [Your systems need to be](https://gettingthingsdone.com/) faster than you (can) think.

by saving a task as a `command`, and saving the environment variables used as an `entity`,

- I can remember how I did a thing.
- I can replay the thing I did.
- I can go back and see if I was right.
- I can keep my things together as simple files and folders.
- I can keep my projects/data organized into categories (an entity folder for each `area of focus`).
- I can pass-on project files/folders onto someone else, as is.
- I can visualize the structure of all my data.
- I can internalize the content of all my data.




## koad:io at a glance

koad:io starts with a handful of [wrapper commands](https://book.koad.sh/reference/koad-io/commands).  Using these commands and a basic directory structure, koad:io makes it easy to remember where you leave your digital thoughts/things.


### commands

> many people don't like to use the command prompt but we know [that is were the magic happens](https://book.koad.sh/cheatsheets/bourn-again-scripting).

for those who use-and-know bash, koad:io will be easy to understand and [those who don't know](https://book.koad.sh/getting-started/) bash will always be waiting for someone to develop a UI they can install. 



#### examples

start the software that is a website called book.koad.sh.
```bash
alice start site book.koad.sh
```

Open the element PWA as Alice and logged in as Alice
```bash
alice open element
```

SSH into a server called toronto and passwordlessly log in as Alice
```bash
alice ssh toronto
```

koad:io doesnt come with commands, they are meant to be added each by you, the creator of this space.

> the documentation is shit right now, a collection of barf; but you can see if it helps you to understand were we are going here.  [book.koad.sh](book.koad.sh)


#### chain reactions

when calling a koad:io command, there is a chain-reaction of command files that get evaluated; this is where you can create and customize each command to run specific to the entity and/or the `current working directory`. 

- you call an entity wrapper, ie: `alice start`
- if you didn't specify any arguments (ie: `alice`), stop here and pass the call to [the `executed-without-arguments.sh` hook](https://github.com/koad/io/blob/main/hooks/executed-without-arguments.sh).
- `alice` loads some general environment details
   - `ENTITY=alice`   
   - `CWD=$PWD` (the directory in which the command is issued)
- then calls the koad:io cli wrapper
   - `~/.koad-io/bin/koad-io $@`
- koad:io cli wrapper loads [`entity` specific environment details](https://book.koad.sh/reference/koad-io/entity/?h=entity)
   - `~/.koad-io/.env`   (if exists)  
   - `~/.$ENTITY/.env`   (if exists)  
   - `~/.$ENTITY/.credentials`   (if exists)  
- then, finds the most relevant regular command by searching in the following locations
   - uses the results from the last location a command is found in.
      * the deepest directory that contains either a `command.sh` file or a `$COMMAND_NAME.sh` file.
   - `~/.koad-io/commands/`  
   - `~/.$ENTITY/commands/`  
   - checks the current working directory (CWD)
      - `$CWD/commands/`  
   - if a command of the same name is in the current directory 
      - use it instead: `./$COMMAND_NAME.sh`
      - load more environment vars 
         - `$CWD/.env`   (if exists)  
         - `$CWD/.credentials`   (if exists)  
- finally, call the chosen command with
   - environment details from the chain reaction
   - the remaining arguments passed into the entity cli wrapper

#### examples explained

no1
```bash
alice probe domain koad.sh
```
is similar to / wraps to
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
is similar to / wraps to
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

> you can see that using this very general structure, you can create very specific outcomes.



## install koad:io

create the `~/.koad-io` folder with a clone of [this repo](https://github.com/koad/io)
```bash
git clone https://github.com/koad/io.git ~/.koad-io
```

add the `~/.koad-io/bin` folder to your path (add this to the end of your `~/.bashrc` file)
```bash
[ -d ~/.koad-io/bin ] && export PATH=$PATH:$HOME/.koad-io/bin
```


### create an entity

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

You can ignore the overwhelming possibilities for now and focus on populating your commands folder with whatever creative thing you desire.


### create commands

bookmark [koad's bash cheatsheet](https://book.koad.sh/cheatsheets/bourn-again-scripting/) as it is a handy resource for creating new tasks/commands.


#### global commands

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

#### run

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


### entity specific commands

commands can be specific to the entity

#### create

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

#### run

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


### folder specific commands

You can use your entity's environment anywhere you want.

#### create

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

#### run

inside ~/some/random/folder/
```bash
cd ~/some/random/folder/
alice hello
alice hello arg1 arg2 arg3 arg4
```



### preload

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



### 🤝 Support

As mentioned above, I am an amateur; 

I have been using computers for a long time, programming for a long time; but, I totally suck in a lot of ways.  

> I'd appreciate any feedback from any seasoned `bash` users out there!  

Contributions, issues, and feature requests are welcome!  

Give a ⭐️ if you like this project!


P.S.  somebody somewhere, sometime, will create a voice controller for this,. so keep that in mind when creating commands.  You have full control, imagine if you were able to teach siri over time (for yourself);  it would be amazing.  


/koad
