#!/usr/bin/env bash

[[ $ENTITY ]] && MOTHER=$ENTITY

ENTITY=$1
DATADIR=$HOME/.$ENTITY

# TODO: if fold length is more than 80, make it 80
WORD_WRAP_WIDTH=$(tput cols)

echo
echo

echo "  o                                        o    o     o                 "
echo " <|>                                      <|>  <|>  _<|>_               "
echo " / \                                      < \  < >                      "
echo " \o/  o/   o__ __o       o__ __o/    o__ __o/         o      o__ __o    "
echo "  |  /v   /v     v\     /v     |    /v     |         <|>    /v     v\   "
echo " / \/>   />       <\   />     / \  />     / \        / \   />       <\  "
echo " \o/\o   \         /   \      \o/  \      \o/   o    \o/   \         /  "
echo "  |  v\   o       o     o      |    o      |   <|>    |     o       o   "
echo " / \  <\  <\__ __/>     <\__  / \   <\__  / \  < >   / \    <\__ __/>   "

echo
echo
echo "koad:io 2016-2022 © kingofalldata.com"
echo "https://github.com/koad/io"
echo && printf '%s\n' "koad:io comes with ABSOLUTELY NO WARRANTY, to the extent permitted by applicable law." | fold -w $WORD_WRAP_WIDTH -s
echo

echo "this will take some time to gestate $ENTITY"
printf '%s\n' "documentation is a 'work in progress' (it sucks), but you can check it out while you wait." | fold -w $WORD_WRAP_WIDTH -s
echo "https://book.koad.sh/reference/koad-io-entity/"
echo

if [ $# -eq 0 ]
  then
    echo "No arguments supplied"
    exit 1
fi

[ -d $DATADIR ] && echo 'Directory already exists, cannot proceed.' && exit 1


function shutdown() {
  tput cnorm # reset cursor
}
trap shutdown EXIT

function cursorBack() {
  echo -en "\033[$1D"
}

SPINNER_POS=0
function spinner() {
  # make sure we use non-unicode character type locale 
  # (that way it works for any locale as long as the font supports the characters)
  local LC_CTYPE=C

  local pid=$1 # Process Id of the previous running command
  local spin='⣾⣽⣻⢿⡿⣟⣯⣷'
  local charwidth=3

  tput civis # cursor invisible
  while kill -0 $pid 2>/dev/null; do
    SPINNER_POS=$(((SPINNER_POS + $charwidth) % ${#spin}))
    printf "%s" "${spin:$SPINNER_POS:$charwidth}"

    cursorBack 1
    sleep .1
    # sleep .33
  done
  tput cnorm
  wait $pid # capture exit code
  return $?
}

echo "About to gestate a new koad:io entity called $ENTITY, if you wish to abort this press CTRL+C now."
sleep 3 & spinner $! && sleep .3;
sleep 6 & spinner $! && sleep .6;
sleep 9 & spinner $! && sleep .9;

echo && echo "Let's go!";
echo && sleep 1 & spinner $!
echo "Gestating new koad:io entity '$ENTITY'"
[[ $MOTHER ]] && echo "Gestation arose from ${MOTHER}";

echo && sleep 1 & spinner $!
mkdir -p $DATADIR         && [[ $DEBUG ]] && echo "[init] creating $DATADIR"
mkdir -p $DATADIR/id      && [[ $DEBUG ]] && echo "[init] creating $DATADIR/id"
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

[[ $MOTHER ]] && sleep 1 & spinner $!
[[ $MOTHER ]] && echo "cloning genes from mother $MOTHER";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/skeletons ]] && cp -r $HOME/.$MOTHER/skeletons $HOME/.$ENTITY/  & spinner $! && echo "cloned mother $MOTHER's skeletons to $HOME/.ENTITY/skeletons";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/packages ]]  && cp -r $HOME/.$MOTHER/packages $HOME/.$ENTITY/   & spinner $! && echo "cloned mother $MOTHER's packages to $HOME/.ENTITY/packages";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/commands ]]  && cp -r $HOME/.$MOTHER/commands $HOME/.$ENTITY/   & spinner $! && echo "cloned mother $MOTHER's commands to $HOME/.ENTITY/commands";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/recipes ]]   && cp -r $HOME/.$MOTHER/recipes $HOME/.$ENTITY/    & spinner $! && echo "cloned mother $MOTHER's recipes to $HOME/.ENTITY/recipes";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/assets ]]    && cp -r $HOME/.$MOTHER/assets $HOME/.$ENTITY/     & spinner $! && echo "cloned mother $MOTHER's assets to $HOME/.ENTITY/assets";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/cheats ]]    && cp -r $HOME/.$MOTHER/cheats $HOME/.$ENTITY/     & spinner $! && echo "cloned mother $MOTHER's cheats to $HOME/.ENTITY/cheats";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/hooks ]]     && cp -r $HOME/.$MOTHER/hooks $HOME/.$ENTITY/      & spinner $! && echo "cloned mother $MOTHER's hooks to $HOME/.ENTITY/hooks";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/docs ]]      && cp -r $HOME/.$MOTHER/docs $HOME/.$ENTITY/       & spinner $! && echo "cloned mother $MOTHER's docs to $HOME/.ENTITY/docs";
[[ $MOTHER ]] && echo && sleep 1 & spinner $!

[[ $MOTHER ]] && echo "remembering mother $MOTHER's public identity";
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/id/rsa.pub ]] && cp -r $HOME/.$MOTHER/id/rsa.pub $HOME/.$ENTITY/id/$MOTHER.pub && echo "cloned mother $MOTHER's public rsa key to $HOME/.ENTITY/id/$MOTHER.rsa.pub" && sleep 1 & spinner $!;
[[ $MOTHER ]] && [[ -d $HOME/.$MOTHER/id/dsa.pub ]] && cp -r $HOME/.$MOTHER/id/dsa.pub $HOME/.$ENTITY/id/$MOTHER.pub && echo "cloned mother $MOTHER's public dsa key to $HOME/.ENTITY/id/$MOTHER.rsa.pub" && sleep 1 & spinner $!;
[[ $MOTHER ]] && echo && sleep 1 & spinner $!

[[ ! $MOTHER ]] && MOTHER='mary'
[[ ! $MOTHER ]] && echo "Immaculate Conception, no initial genome!"
[[ ! $MOTHER ]] && echo && sleep 1 & spinner $!

echo "Generating master elliptic curve parameters"
openssl ecparam -name prime256v1 -out $DATADIR/ssl/master-curve-parameters.pem & spinner $!
echo "generated: $DATADIR/ssl/master-curve-parameters.pem"
echo && sleep 1 & spinner $!

echo "Generating master elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/master-curve.pem & spinner $!
echo "generated: $DATADIR/ssl/master-curve.pem"
echo && sleep 1 & spinner $!

echo "Generating device elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/device-curve.pem & spinner $!
echo "generated: $DATADIR/ssl/device-curve.pem"
echo && sleep 1 & spinner $!

echo "Generating relay elliptic curve"
openssl genpkey -aes256 -pass pass:$ENTITY -paramfile $DATADIR/ssl/master-curve-parameters.pem -out $DATADIR/ssl/relay-curve.pem & spinner $!
echo "generated: $DATADIR/ssl/relay-curve.pem"
echo && sleep 1 & spinner $!

echo "Generating seesion key"
openssl genpkey -algorithm EC  -pass pass:$ENTITY -pkeyopt ec_paramgen_curve:P-256 -out $DATADIR/ssl/session.pem & spinner $!
echo "generated: $DATADIR/ssl/session.pem"
echo && sleep 1 & spinner $!

echo "Generating cryptographic device identities ($ENTITY@$HOSTNAME)"
ssh-keygen -t ed25519 -C "$ENTITY@$MOTHER" -f $DATADIR/ssl/ed25519 -P "$ENTITY@$MOTHER" 2>&1 >/dev/null & spinner $! && echo "generated: $DATADIR/id/ed25519"
ssh-keygen -t ecdsa -b 521 -C "$ENTITY@$MOTHER" -f $DATADIR/ssl/ecdsa -P "$ENTITY@$MOTHER" 2>&1 >/dev/null & spinner $! && echo "generated: $DATADIR/id/ecdsa"
ssh-keygen -t rsa -b 4096 -C "$ENTITY@$MOTHER" -f $DATADIR/id/rsa -P "$ENTITY@$MOTHER" 2>&1 >/dev/null & spinner $! && echo "generated: $DATADIR/id/rsa"
ssh-keygen -t dsa -C "$ENTITY@$MOTHER" -f $DATADIR/id/dsa -P "$ENTITY@$MOTHER" 2>&1 >/dev/null & spinner $! && echo "generated: $DATADIR/id/dsa"
echo && sleep 1 & spinner $!

printf '%s\n' "Generating keys to be used during Diffie Hellman Key Exchanges." | fold -w $WORD_WRAP_WIDTH -s
printf '%s\n' "This will help ensure that your new friend can identify herself easily when he sees itself across networks." | fold -w $WORD_WRAP_WIDTH -s
echo "homework: research the Diffie Hellman key exchange process"
echo && sleep 1 & spinner $!

echo "Generating 2048 bit dhparam, this won't take so long, about a minute."
openssl dhparam -out $DATADIR/ssl/dhparam-2048.pem 2048 > /dev/null 2>&1 & spinner $!
echo "generated: $DATADIR/ssl/dhparam-2048.pem 2048"
echo
echo "Generating 4096 bit dhparam, this will take a long time, 10 minutes max?"
openssl dhparam -out $DATADIR/ssl/dhparam-4096.pem 4096 > /dev/null 2>&1 & spinner $!
echo "generated: $DATADIR/ssl/dhparam-4096.pem 4096"
echo && sleep 1 & spinner $!

echo "archving command version information"
echo "# koad:io entity

GESTATED_BY=$MOTHER
GESTATE_VERSION=$(cd $HOME/.koad-io && git rev-parse --short HEAD)
BIRTHDAY=$(date +%y:%m:%d:%H:%M:%S)
NAME=$ENTITY
"> ./VERSION

echo "wrote version information to: $DATADIR/ssl/VERSION"
[ -f $DATADIR/ssl/VERSION ] && cat $DATADIR/ssl/VERSION
echo && sleep 1 & spinner $!

echo "Creating entity wrapper command: $ENTITY"
echo '#!/usr/bin/env bash

export ENTITY="'$ENTITY'"
koad-io "$@";
' > $HOME/.koad-io/bin/$ENTITY
echo && sleep 1 & spinner $!

echo "making '$HOME/.koad-io/bin/$ENTITY' executable"
chmod +x $HOME/.koad-io/bin/$ENTITY
echo && sleep 1 & spinner $!

echo "Gestation of $ENTITY complete!"
echo
echo "Please secure your new friend by backing him up; NOW!"
echo 
echo "All files created for $ENTITY are saved in a single directory: '$HOME/.$ENTITY'"
echo "back up this directory somewhere safe".
# echo "back up the SSL directory twice, use an ESP and print a paper key; this is $ENTITY's keychain"
# echo "bookmark https://book.koad/sh/reference/backup-your-entity for help"
echo && sleep 1 & spinner $!

# TODO: Create a sack of keys used to deal with issuing packages
# TODO: add new package into .bashrc
# TODO: spawn 2 nebula networks using this keyring
#       one for machines
#       one for humans


echo && sleep 3 & spinner $!

echo "Congratulations!"
echo
echo "You've just created a new digital life!"
echo "btw: you can use any existing friend to create another, and take a clone of it's genes!"
echo "ie: > $ENTITY init alice"
echo
echo && sleep 6 & spinner $!

echo "try '$ENTITY test'"
echo "then try '$ENTITY test one two three four'"
echo

echo "have fun with $ENTITY!  I hope you make it into something nice."
echo
echo "/koad"
echo
echo && sleep 9 & spinner $!

echo "-------------------------------------------------------------------------------"
echo "ready player one -> $ENTITY"
echo

# BEGIN KEYBASE SALTPACK SIGNED MESSAGE. kXR7VktZdyH7rvq v5weRa0zkVLF9u3 p5OjMDVxNEwriCo qoL4kKjfDrdZqjK FTlqvHscRKxHsUM diXSxFF1JpLVgR4 Ms7u4II94ER6aLs D3dljGbKO6xNtha QpQdivhMs2xNa8p 5Ib7al08L3381ne W0BjszEnwb1HYRc ChxwAQ4w5KNC5Mp a419MBtGqyGdQSs Jr52lLl9FMUzvuj PCeylOgs9ysFvVL fTIM35t1TxAbk5S 0gEa5WyQCqTgwjJ RT039C6WacGJto2 HvGaD8. END KEYBASE SALTPACK SIGNED MESSAGE.