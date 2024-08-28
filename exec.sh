function resume() {
  echo "Resuming"
  
  solana-keygen recover -o ./.secrets/recover.json

  solana program deploy \
    -k ./.secrets/payer.json \
    --buffer ./.secrets/recover.json \
    --upgrade-authority ./.secrets/payer.json \
    --program-id ./target/deploy/solana_options-keypair.json \
    ./target/deploy/solana_options.so
}

# function close() {
#   echo "Closing"
#   solana program close -k ./keypair.json "32wHkik88Ng8emN7NX6gBTJ8r74r55jc23iSm5tieYxi" --bypass-warning
# }
${@}