KEY=$(mktemp)

## Function to remove decrypted key
function cleanup {
  rm -f $KEY
  echo "Cleaned up. Exiting..."
}

## Wrapper function to decrypt key and run solana command
function cli() {
  # Decrypt key
  gpg --decrypt --quiet ./.secrets/mainnet/deployer.json.gpg > $KEY
  echo "Decrypted key"
  trap cleanup EXIT

  # Run solana command with decrypted key
  solana -k $KEY ${@}
}

# deploy ./target/deploy/solana_options.so
function deploy() {
  cli program deploy ${@}
}

function recover() {
  decrypt
  FILE=./.secrets/recoveries/$(date +"%FT%H%M%S%z").json

  echo "Recovering with $FILE"
  
  solana-keygen recover -o $FILE

  cli program deploy \
    --buffer $FILE \
    --upgrade-authority $KEY \
    --program-id ./target/deploy/solana_options-keypair.json \
    ./target/deploy/solana_options.so
}


${@}
