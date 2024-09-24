- Make sure you are on the write network

1. Build the program `anchor build`
1. Write to intermediate buffer account
   solana program write-buffer -k ./.secrets/payer.json ./target/deploy/solana_options.so

Troubleshooting
❯ solana program extend So1ar1uyyJ2bhm4DTN3M2wWkug4trVknn2kdZ2vD2Vh 20000 -k ./.secrets/payer.json
