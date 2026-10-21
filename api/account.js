import { handleAccountRequest } from "../account/http.js";

export const config = {
    maxDuration: 30,
};

export default {
    fetch(request) {
        return handleAccountRequest(request);
    },
};
