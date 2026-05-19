# Dacentec.com CPU Dater Shim

This directory contains the CPU Dater Shim for the Passenger Chrome Extension, designed to enhance the browsing experience on Dacentec by appending CPU launch dates to product listings.

## Overview

The CPU Dater Shim is a JavaScript script that is automatically injected into Dacentec's dedicated servers listing page. It parses the CPU model from the table entries and appends the launch year next to the CPU description, facilitating a better decision-making process for users looking to rent servers.

## Features

- **CPU Launch Date Appending**: Automatically identifies CPU models in the product listings and appends their launch dates.

## Usage

This shim runs automatically on pages matching `https://billing.dacentec.com/hostbill/index.php?/cart/dedicated-servers/*`. It requires no configuration or setup from the user's end—simply browse to the Dacentec dedicated servers listing page, and the CPU launch dates will be displayed alongside the CPU models.

## Support and Contribution

If you encounter any issues or would like to contribute to the development of this shim, please open an issue or pull request in the main Passenger Chrome Extension repository.

## Referral

If you're considering renting a server from Dacentec, use my referral code to get started: [https://billing.dacentec.com/hostbill/?affid=72](https://billing.dacentec.com/hostbill/?affid=72). Your support is greatly appreciated!

## License

This shim is part of the [koad:io Passenger](https://github.com/koad/io/tree/main/passenger) and is subject to the same GPL-2.0 license as the main project.
