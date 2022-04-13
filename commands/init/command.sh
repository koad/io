#!/usr/bin/env bash

if [ $# -eq 0 ]
  then
    echo "No arguments supplied"
    exit 1
fi
echo
ENTITY=$1
echo "$ENTITY,..?"
sleep 1

fold_length=$(tput cols)
DATADIR=$HOME/.$ENTITY

sleep 1
[ -d $DATADIR ] && echo 'Directory already exists, cannot proceed.' && exit 1

echo "No problem, gestating $ENTITY"

mkdir -p $DATADIR && [ -v $2 ] && echo "[init] $DATADIR"
mkdir -p $DATADIR/bin && [ -v $2 ] && echo "[init] $DATADIR/bin"
mkdir -p $DATADIR/etc && [ -v $2 ] && echo "[init] $DATADIR/etc"
mkdir -p $DATADIR/usr && [ -v $2 ] && echo "[init] $DATADIR/usr"
mkdir -p $DATADIR/lib && [ -v $2 ] && echo "[init] $DATADIR/lib"
mkdir -p $DATADIR/var && [ -v $2 ] && echo "[init] $DATADIR/var"
mkdir -p $DATADIR/man && [ -v $2 ] && echo "[init] $DATADIR/man"
mkdir -p $DATADIR/ssl && [ -v $2 ] && echo "[init] $DATADIR/ssl"
mkdir -p $DATADIR/proc && [ -v $2 ] && echo "[init] $DATADIR/proc"
mkdir -p $DATADIR/home && [ -v $2 ] && echo "[init] $DATADIR/home"
mkdir -p $DATADIR/media && [ -v $2 ] && echo "[init] $DATADIR/media"
mkdir -p $DATADIR/archive && [ -v $2 ] && echo "[init] $DATADIR/archive"
mkdir -p $DATADIR/keybase && [ -v $2 ] && echo "[init] $DATADIR/keybase"
[ ! -v $2 ] && echo "[[ gestation output locations suppressed ]]"

echo
echo
echo "Creating a key to be used during Diffie Hellman Key Exchanges.  This will help ensure that your new friend can identify herself easily when she sees herself.  It is also used when running secure dapps to ensure each dapp is correctly talking to the right friend before any handshaking begins."
echo
echo "homework: research the Diffie Hellman key exchange process"
echo

echo "Generating 2048 bit dhparam, this won't take so long, about a minute."
openssl dhparam -out $DATADIR/ssl/dhparam-2048.pem 2048 > /dev/null 2>&1

echo "Generating 4096 bit dhparam, this will take a long time, 10 minutes max?"
openssl dhparam -out $DATADIR/ssl/dhparam-4096.pem 4096 > /dev/null 2>&1

echo "Generating master elliptic curve parameters"
openssl ecparam -name prime256v1 -out $DATADIR/ssl/master-curve-parameters.pem

echo "Generating master elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/master-curve.pem

echo "Generating device elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/device-curve.pem

echo "Generating relay elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/relay-curve.pem

echo "Generating seesions key"
openssl genpkey -algorithm EC  -pass pass:$ENTITY -pkeyopt ec_paramgen_curve:P-256 -out $DATADIR/ssl/session.pem

echo
echo "Keychain generated. Please secure your new friend by backing up her keychain.  Type '$ENTITY backup keychain'"

sleep 1


echo "Creating entity wrapper command: $ENTITY"
cp ~/.koad-io/bin/entity ~/.koad-io/bin/$ENTITY
echo

[ -f $DATADIR/bin/version ] && cat $DATADIR/bin/version
echo "gestation complete!"
echo
echo "koad:io 2016-2022 © kingofalldata.com"
echo "https://github.com/koad/io"
echo
echo
echo "ready player one -> $ENTITY"


# TODO: Create a sack of keys used to deal with issuing packages

# TODO: add new package into .bashrc

# TODO: spawn 2 nebula networks using this keyring
# 			one for machines
# 			one for humans
echo
sleep 1
echo "Congratulations!"
echo
echo && printf '%s\n' "You've just created brand a new digital life!  Enjoy YOUR new digital best friend! You can keep this new friend private, or choose to make aspects of her public.  You are in control." | fold -w $fold_length -s
echo && printf '%s\n' "To help you keep yourself organized within your own mind, it is recommended to create a new digital friend for each one of the different focus areas of your life.  Focus areas generally involve different groups of people and activities." | fold -w $fold_length -s
echo && printf '%s\n' "An example of a focus area is,..  your band, your brand, your family, your business, your church, your team and hopefully even yourself.  You want to keep a solid barrier between the data from each area of your life; work and play." | fold -w $fold_length -s
echo && printf '%s\n' "You can create as many new friends as you wish, and teach them how to gather data and communicate with each-other to bring you the most personalized and private digital assistant experience known to man." | fold -w $fold_length -s
echo && printf '%s\n' "You can use any existing friend to create another." | fold -w $fold_length -s
echo "ie: > $ENTITY init alice"
echo
echo && printf '%s\n' "NOTICE:  This software is highly experimental, is self-hosted and is attempting to be cryptographically secure.  Be sure to understand each of these three things and take the time design your backup and recovery plan.  Always keep a minimum of 3 devices (or more) active at one time;  Your data's safety increases with each trusted device you keep active." | fold -w $fold_length -s
echo && printf '%s\n' "WARNING:  If you lose access to all of your devices at one time then YOU WILL BE LOCKED OUT and unable to recover your new friend, she will be gone forever.  Be sure to learn about cryptography.  It is risky to use cryptographic tools without knowing what they are and how they work." | fold -w $fold_length -s
echo
echo && printf '%s\n' "If you find bugs, or have questions, please join us within our keybase channels -> https://keybase.io/team/canadaecoin" | fold -w $fold_length -s
echo && printf '%s\n' "Use any of the commands with the options -h or --help to find out more about each command." | fold -w $fold_length -s
echo "> $ENTITY --help"
echo && printf '%s\n' "You will need to either add your new friend to your path manually, or, close this terminal and open another." | fold -w $fold_length -s
echo '> export PATH=$PATH:'$DATADIR'/bin'
echo ""
echo && printf '%s\n' "To start using $ENTITY, assign her some roles and responsibilities within the appropriate UI" | fold -w $fold_length -s
echo "cli: > $ENTITY enter control"
echo "gui: > $ENTITY show control"

