#!/usr/bin/env bash

echo
echo
echo "koad:io 2016-2022 © kingofalldata.com"
echo "https://github.com/koad/io"
echo && printf '%s\n' "koad:io comes with ABSOLUTELY NO WARRANTY, to the extent permitted by applicable law." | fold -w $WORD_WRAP_WIDTH -s
echo

if [ $# -eq 0 ]
  then
    echo "No arguments supplied"
    exit 1
fi
echo
ENTITY=$1
echo "$ENTITY,..?"


WORD_WRAP_WIDTH=$(tput cols)
DATADIR=$HOME/.$ENTITY
# TODO: if fold length is more than 80, make it 80

sleep 1
[ -d $DATADIR ] && echo 'Directory already exists, cannot proceed.' && exit 1

echo "No problem, gestating $ENTITY"
echo

mkdir -p $DATADIR         && [[ $DEBUG ]] && echo "[init] creating $DATADIR"
mkdir -p $DATADIR/bin     && [[ $DEBUG ]] && echo "[init] creating $DATADIR/bin"
mkdir -p $DATADIR/etc     && [[ $DEBUG ]] && echo "[init] creating $DATADIR/etc"
mkdir -p $DATADIR/usr     && [[ $DEBUG ]] && echo "[init] creating $DATADIR/usr"
mkdir -p $DATADIR/lib     && [[ $DEBUG ]] && echo "[init] creating $DATADIR/lib"
mkdir -p $DATADIR/var     && [[ $DEBUG ]] && echo "[init] creating $DATADIR/var"
mkdir -p $DATADIR/man     && [[ $DEBUG ]] && echo "[init] creating $DATADIR/man"
mkdir -p $DATADIR/ssl     && [[ $DEBUG ]] && echo "[init] creating $DATADIR/ssl"
mkdir -p $DATADIR/proc    && [[ $DEBUG ]] && echo "[init] creating $DATADIR/proc"
mkdir -p $DATADIR/home    && [[ $DEBUG ]] && echo "[init] creating $DATADIR/home"
mkdir -p $DATADIR/media   && [[ $DEBUG ]] && echo "[init] creating $DATADIR/media"
mkdir -p $DATADIR/archive && [[ $DEBUG ]] && echo "[init] creating $DATADIR/archive"
mkdir -p $DATADIR/keybase && [[ $DEBUG ]] && echo "[init] creating $DATADIR/keybase"

[ ! -v $DEBUG ] && echo "[[ gestation output locations suppressed ]]"

echo
echo
echo

sleep 1
echo "Generating master elliptic curve parameters"
openssl ecparam -name prime256v1 -out $DATADIR/ssl/master-curve-parameters.pem
echo "generated: $DATADIR/ssl/master-curve-parameters.pem"
echo

sleep 1
echo "Generating master elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/master-curve.pem
echo "generated: $DATADIR/ssl/master-curve.pem"
echo

sleep 1
echo "Generating device elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/device-curve.pem
echo "generated: $DATADIR/ssl/device-curve.pem"
echo

sleep 1
echo "Generating relay elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/relay-curve.pem
echo "generated: $DATADIR/ssl/relay-curve.pem"
echo

sleep 1
echo "Generating seesions key"
openssl genpkey -algorithm EC  -pass pass:$ENTITY -pkeyopt ec_paramgen_curve:P-256 -out $DATADIR/ssl/session.pem
echo "generated: $DATADIR/ssl/session.pem"
echo


sleep 1
echo && printf '%s\n' "Generating a key to be used during Diffie Hellman Key Exchanges.  This will help ensure that your new friend can identify herself easily when she sees herself.  It is also used when running secure dapps to ensure each dapp is correctly talking to the right friend before any handshaking begins." | fold -w $WORD_WRAP_WIDTH -s

echo
echo "homework: research the Diffie Hellman key exchange process"
echo
sleep 1
echo "Generating 2048 bit dhparam, this won't take so long, about a minute."
openssl dhparam -out $DATADIR/ssl/dhparam-2048.pem 2048 > /dev/null 2>&1
echo "generated: $DATADIR/ssl/dhparam-2048.pem 2048"
echo
echo "Generating 4096 bit dhparam, this will take a long time, 10 minutes max?"
# openssl dhparam -out $DATADIR/ssl/dhparam-4096.pem 4096 > /dev/null 2>&1
echo "generated: $DATADIR/ssl/dhparam-4096.pem 4096"
sleep 1


echo
echo "Keychain generated. Please secure your new friend by backing him up; NOW!"
echo 
echo "All files created for $ENTITY are saved in a single directory: '$HOME/.$ENTITY'"
echo "back up this directory somewhere safe backup keychain".
echo "back up the SSL directory twice, use an ESP and print a paper key"
echo "bookmark https://book.koad/sh/reference/backup-your-entity for help"
echo
sleep 1

echo "Creating entity wrapper command: $ENTITY"
echo '#!/bin/bash
export ENTITY='$ENTITY'
koad-io "$@";' > $HOME/.koad-io/bin/$ENTITY

# echo "creating symbolic link from '$HOME/.koad-io/bin/entity' to '$HOME/.koad-io/bin/$ENTITY'"
# ln -s $HOME/.koad-io/bin/entity $HOME/.koad-io/bin/$ENTITY

echo "making '$HOME/.koad-io/bin/$ENTITY' executable"
chmod +x $HOME/.koad-io/bin/$ENTITY

echo
sleep 1

echo "archving command version information"
git rev-parse --short HEAD > $DATADIR/VERSION
[ -f $DATADIR/VERSION ] && cat $DATADIR/VERSION
echo "wrote version information to: $DATADIR/VERSION"
echo

sleep 1

echo "...gestation complete!"
sleep 1
echo
sleep 1
echo
sleep 1
echo "ready player one -> $ENTITY"
sleep 1


# TODO: Create a sack of keys used to deal with issuing packages

# TODO: add new package into .bashrc

# TODO: spawn 2 nebula networks using this keyring
#       one for machines
#       one for humans
echo
sleep 1
echo "Congratulations!"
echo
# echo && printf '%s\n' "You've just created brand a new digital life!  Enjoy YOUR new digital best friend! You can keep this new friend private, or choose to make aspects of her public.  You are in control." | fold -w $WORD_WRAP_WIDTH -s
# echo && printf '%s\n' "To help you keep yourself organized within your own mind, it is recommended to create a new digital friend for each one of the different focus areas of your life.  Focus areas generally involve different groups of people and activities." | fold -w $WORD_WRAP_WIDTH -s
# echo && printf '%s\n' "An example of a focus area is,..  your band, your brand, your family, your business, your church, your team and hopefully even yourself.  You want to keep a solid barrier between the data from each area of your life; work and play." | fold -w $WORD_WRAP_WIDTH -s
# echo && printf '%s\n' "You can create as many new friends as you wish, and teach them how to gather data and communicate with each-other to bring you the most personalized and private digital assistant experience known to man." | fold -w $WORD_WRAP_WIDTH -s
echo && printf '%s\n' "You can use any existing friend to create another." | fold -w $WORD_WRAP_WIDTH -s
echo "ie: > $ENTITY init alice"
echo
echo
echo
# echo && printf '%s\n' "NOTICE:  This software is highly experimental, is self-hosted and is attempting to be cryptographically secure.  Be sure to understand each of these three things and take the design your backup and recovery plan.  Always keep a minimum of 3 devices (or more) active at one time;  Your data's safety increases with each trusted device you keep active." | fold -w $WORD_WRAP_WIDTH -s
# echo && printf '%s\n' "WARNING:  If you lose access to all of your devices at one then YOU WILL BE LOCKED OUT and unable to recover your new friend, she will be gone forever.  Be sure to learn about cryptography.  It is risky to use cryptographic tools without knowing what they are and how they work." | fold -w $WORD_WRAP_WIDTH -s
echo
# echo && printf '%s\n' "If you find bugs, or have questions, please join us within our keybase channels -> https://keybase.io/team/canadaecoin" | fold -w $WORD_WRAP_WIDTH -s
# echo && printf '%s\n' "Use any of the commands with the options -h or --help to find out more about each command." | fold -w $WORD_WRAP_WIDTH -s
# echo "> $ENTITY --help"
# echo && printf '%s\n' "You will need to either add your new friend to your path manually, or, close this terminal and open another." | fold -w $WORD_WRAP_WIDTH -s
# echo '> export PATH=$PATH:'$DATADIR'/bin'
echo ""
# echo && printf '%s\n' "To start using $ENTITY, assign her some roles and responsibilities within the appropriate UI" | fold -w $WORD_WRAP_WIDTH -s
# echo "cli: > $ENTITY enter control"
# echo "gui: > $ENTITY show control"

echo "try 'alice test'"
echo " then try 'alice test one two three four'"

echo ""
echo "have fun with $ENTITY!  I hope you make it into something nice."
echo ""
echo "/koad"

