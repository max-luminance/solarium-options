PROGRAM_ID="3JZ99S1BGfcdExZ4immxWKSGAFkbe3hxZo9NRxvrair4"

function recover() {
  FILE=./.secrets/recoveries/$(date +"%FT%H%M%S%z").json

  echo "Recovering with $FILE"
  
  solana-keygen recover -o $FILE

  solana program deploy \
    -k ./.secrets/payer.json \
    --buffer $FILE \
    --upgrade-authority ./.secrets/payer.json \
    --program-id ./target/deploy/solana_options-keypair.json \
    ./target/deploy/solana_options.so
}

function extend {
  solana program extend $PROGRAM_ID 20000 -k ./.secrets/payer.json
}

# function close() {
#   echo "Closing"
#   solana program close -k ./keypair.json "32wHkik88Ng8emN7NX6gBTJ8r74r55jc23iSm5tieYxi" --bypass-warning
# }
${@}