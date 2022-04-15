#!/usr/bin/env bash

ENTITY=$1
DATADIR=$HOME/.$ENTITY

# TODO: if fold length is more than 80, make it 80
WORD_WRAP_WIDTH=$(tput cols)

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

[ -d $DATADIR ] && echo 'Directory already exists, cannot proceed.' && exit 1

sleep 1
echo "Gestating new koad:io entity '$ENTITY'"
echo

sleep 1
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
[ ! -v $DEBUG ] && echo "[[ gestation output locations suppressed ]]" && echo

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
printf '%s\n' "Generating keys to be used during Diffie Hellman Key Exchanges." | fold -w $WORD_WRAP_WIDTH -s
printf '%s\n' "This will help ensure that your new friend can identify herself easily when he sees itself across networks." | fold -w $WORD_WRAP_WIDTH -s
echo "homework: research the Diffie Hellman key exchange process"
echo

sleep 1
echo "Generating 2048 bit dhparam, this won't take so long, about a minute."
openssl dhparam -out $DATADIR/ssl/dhparam-2048.pem 2048 > /dev/null 2>&1
echo "generated: $DATADIR/ssl/dhparam-2048.pem 2048"
echo
echo "Generating 4096 bit dhparam, this will take a long time, 10 minutes max?"
openssl dhparam -out $DATADIR/ssl/dhparam-4096.pem 4096 > /dev/null 2>&1
echo "generated: $DATADIR/ssl/dhparam-4096.pem 4096"
sleep 1

echo
echo "Keychain generated. Please secure your new friend by backing him up; NOW!"
echo 
echo "All files created for $ENTITY are saved in a single directory: '$HOME/.$ENTITY'"
echo "back up this directory somewhere safe".
echo "back up the SSL directory twice, use an ESP and print a paper key; this is $ENTITY's keychain"
echo "bookmark https://book.koad/sh/reference/backup-your-entity for help"
echo

sleep 1
echo "Creating entity wrapper command: $ENTITY"
echo '#!/usr/bin/env bash

export ENTITY="'$ENTITY'"
koad-io "$@";
' > $HOME/.koad-io/bin/$ENTITY
echo

sleep 1
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
echo

# TODO: Create a sack of keys used to deal with issuing packages

# TODO: add new package into .bashrc

# TODO: spawn 2 nebula networks using this keyring
#       one for machines
#       one for humans
sleep 3
echo "Congratulations!"
echo
echo "You've just created a new digital life!"
echo "btw: you can use any existing friend to create another."
echo "ie: > $ENTITY init alice"
echo

echo "try '$ENTITY test'"
echo "then try '$ENTITY test one two three four'"
echo

echo "have fun with $ENTITY!  I hope you make it into something nice."
echo
echo "/koad"
echo
echo "-------------------------------------------------------------------------------"

sleep 3
echo "ready player one -> $ENTITY"
echo
